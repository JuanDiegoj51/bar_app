import { Request, Response } from "express";
import prisma from "../db/prismaClient";
import { can, Role } from "../lib/rbac";

/** Convierte a número de forma segura */
function num(v: any): number {
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Obtiene el branchId del recurso (orden o su mesa) */
function getResourceBranchId(order: any): number | null {
  return order?.branchId ?? order?.table?.branchId ?? null;
}

/** Recalcula total de la orden sumando subtotales y devuelve la orden actualizada */
async function recalcOrderTotal(orderId: number) {
  return prisma.$transaction(async (tx) => {
    const items = await tx.orderItem.findMany({ where: { orderId } });
    const total = items.reduce((s, it) => s + num(it.subtotal), 0);
    return tx.order.update({
      where: { id: orderId },
      data: { total: String(total) },
      include: { items: { include: { product: true } }, table: true },
    });
  });
}

/**
 * Reglas de acceso por rol:
 * - MANAGER: todas las sedes
 * - ADMIN / WAITER / CASHIER: solo su branchId (deben tener branch asignada)
 */
const assertScope = (req: Request, targetBranchId: number) => {
  const u = req.user!;
  if (u.role === "MANAGER") return true;
  if (!u.branchId) return false;
  return u.branchId === targetBranchId;
};

/**
 * POST /api/orders
 * Crea un pedido vacío para una mesa y sede. total = 0 inicialmente.
 * Body: { tableId, notes? }
 */
// POST /api/orders  { tableId: number, items: [{productId, qty}], notes?: string }
export const createOrder = async (req: Request, res: Response) => {
  const { tableId, items, notes } = req.body as {
    tableId?: number;
    items?: Array<{ productId: number; qty: number }>;
    notes?: string;
  };

  // Validaciones básicas
  if (!Number.isFinite(tableId)) {
    return res.status(400).json({ message: "tableId requerido" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "items requerido (no vacío)" });
  }
  for (const it of items) {
    if (!Number.isFinite(it?.productId) || !Number.isFinite(it?.qty) || it.qty <= 0) {
      return res.status(400).json({ message: "items inválidos (productId/qty)" });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1) Validar mesa
      const table = await tx.table.findUnique({ where: { id: Number(tableId) } });
      if (!table) throw new Error("Mesa no existe");

      // 2) Cargar productos necesarios
      const productIds = items.map((i) => i.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, price: true },
      });
      const priceMap = new Map<number, number>(
        products.map((p) => [p.id, Number.parseFloat(String(p.price)) || 0])
      );

    // 👇 NUEVO: bloquear si no está disponible
    if (table.status !== "AVAILABLE") {
    // puedes usar throw y capturarlo abajo, o responder aquí con 409
    throw Object.assign(new Error("La mesa no está disponible"), { code: "TABLE_NOT_AVAILABLE" });
    }

      // 3) Crear orden en PENDING
    const userId = Number((req as any).user?.id);
    const data: any = {
        status: "PENDING",
        notes: notes ?? undefined,
        tableId: table.id,
        total: "0",
    };
    if (typeof table.branchId === "number") data.branchId = table.branchId;
    if (Number.isFinite(userId)) data.createdById = userId;
    const order = await tx.order.create({ data });

      // 4) Crear ítems (con unitPrice y subtotal)
      let total = 0;
      for (const it of items) {
        const unit = priceMap.get(it.productId) ?? 0;
        const subtotal = unit * it.qty;
        total += subtotal;

        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: it.productId,
            quantity: it.qty,
            unitPrice: String(unit),
            subtotal: String(subtotal),
          },
        });
      }

      // 5) Actualizar total de la orden
      const updated = await tx.order.update({
        where: { id: order.id },
        data: { total: String(total) },
        include: {
          table: true,
          items: { include: { product: true } },
          branch: true,
          createdBy: true,
        },
      });

      // 6) Marcar mesa como OCCUPIED (opcional según tu lógica)
      await tx.table.update({
        where: { id: table.id },
        data: { status: "OCCUPIED" },
      });

      return updated;
    });

    return res.status(201).json(result);
  } catch (err: any) {
  console.error("createOrder error:", err);
  if (err?.code === "TABLE_NOT_AVAILABLE") {
    return res.status(409).json({ message: "La mesa no está disponible" });
  }
  const msg = err?.message || "Server error";
  return res.status(500).json({ message: msg });
}
};



/**
 * GET /api/orders
 * MANAGER: ve todos; otros: solo su branch.
 * Soporta filtros: ?tableId=...&status=PENDING
 */
export const getOrders = async (req: Request, res: Response) => {
  try {
    const u = req.user!;
    const { tableId, status } = req.query;

    const where: any = {};
    if (status) where.status = String(status);

    if (tableId) {
      where.tableId = Number(tableId);
    }

    if (u.role !== "MANAGER") {
      if (!u.branchId) {
        return res.status(400).json({ message: "User has no branch assigned" });
      }
      where.branchId = u.branchId;
    }

    const orders = await prisma.order.findMany({
      where,
      include: { table: true, items: true, branch: true, createdBy: true },
      orderBy: { createdAt: "desc" },
    });

    return res.json(orders);
  } catch (e) {
    console.error("getOrders error:", e);
    return res.status(500).json({ message: "Error fetching orders" });
  }
};

/**
 * GET /api/orders/:id
 * Respeta alcance por branch.
 */
export const getOrderById = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id },
      include: { table: true, items: { include: { product: true } }, branch: true, createdBy: true },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (!assertScope(req, order.branchId)) {
      return res.status(403).json({ message: "Forbidden (branch scope)" });
    }

    return res.json(order);
  } catch (e) {
    console.error("getOrderById error:", e);
    return res.status(500).json({ message: "Error fetching order" });
  }
};

/**
 * PUT /api/orders/:id/status
 * Cambia estado: PENDING → PAID/CANCELLED
 * - CASHIER: puede marcar PAID (su branch)
 * - MANAGER: puede todo, cualquier branch
 * - ADMIN: su branch
 * - WAITER: NO puede cambiar a PAID/CANCELLED
 */
export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const u = req.user!;
    const id = Number(req.params.id);
    const { status } = req.body as { status?: "PENDING" | "PAID" | "CANCELLED" };

    if (!status || !["PENDING", "PAID", "CANCELLED"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (!assertScope(req, order.branchId)) {
      return res.status(403).json({ message: "Forbidden (branch scope)" });
    }

    // Reglas por rol
    if (u.role === "WAITER") {
      return res.status(403).json({ message: "Waiters cannot change order status" });
    }
    if (u.role === "CASHIER" && status !== "PAID") {
      return res.status(403).json({ message: "Cashiers can only mark as PAID" });
    }

    // Si no se marca PAID/CANCELLED, solo actualiza estado simple
    if (status !== "PAID") {
      const updated = await prisma.order.update({
        where: { id },
        data: { status },
      });

      // Si se canceló, liberar mesa
      if (status === "CANCELLED") {
        await prisma.table.update({
          where: { id: order.tableId },
          data: { status: "AVAILABLE" },
        });
      }

      return res.json({ message: "Order status updated ✅", order: updated });
    }

    // 🧮 status = "PAID": validar stock y descontar en transacción
    const updated = await prisma.$transaction(async (tx) => {
      // Re-lee productos y valida stock
      for (const item of order.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new Error(`Product ${item.productId} not found`);
        if (product.branchId !== order.branchId) {
          throw new Error(`Product ${product.id} not in order's branch`);
        }
        if (product.stockQty < item.quantity) {
          // Lanzamos error controlado si falta stock
          throw new Error(`INSUFFICIENT_STOCK:${product.name}`);
        }
      }

      // Descontar y registrar movimientos
      for (const item of order.items) {
        const product = await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { decrement: item.quantity } },
        });

        await tx.stockMovement.create({
          data: {
            type: "OUT",
            quantity: item.quantity,
            reason: "Sale (order paid)",
            productId: product.id,
            branchId: product.branchId,
            createdById: u.id,
            orderId: order.id,
          },
        });
      }

      // Actualiza estado a PAID
      const ord = await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID" },
      });

      // Liberar mesa
      await tx.table.update({
        where: { id: order.tableId },
        data: { status: "AVAILABLE" },
      });

      return ord;
    });

    return res.json({ message: "Order paid ✅ (stock updated)", order: updated });
  } catch (e: any) {
    console.error("updateOrderStatus error:", e);
    if (typeof e.message === "string" && e.message.startsWith("INSUFFICIENT_STOCK:")) {
      const name = e.message.split(":")[1];
      return res.status(409).json({ message: `Insufficient stock for product: ${name}` });
    }
    return res.status(500).json({ message: "Error updating status" });
  }
};


export const updateOrderItemQuantity = async (req: Request, res: Response) => {
  try {
    const u = req.user!;
    const orderId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const { quantity } = req.body as { quantity?: number };

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ message: "Valid quantity is required (> 0)" });
    }

    const item = await prisma.orderItem.findUnique({
      where: { id: itemId },
      include: { order: true, product: true },
    });
    if (!item || item.orderId !== orderId) {
      return res.status(404).json({ message: "OrderItem not found for this order" });
    }

    // Alcance por branch
    if (!assertScope(req, item.order.branchId)) {
      return res.status(403).json({ message: "Forbidden (branch scope)" });
    }
    if (item.order.status !== "PENDING") {
      return res.status(400).json({ message: "Cannot modify a non-PENDING order" });
    }

    const newSubtotal = (Number(item.unitPrice) * quantity).toFixed(2);

    await prisma.orderItem.update({
      where: { id: itemId },
      data: { quantity, subtotal: String(newSubtotal) },
    });

    const updatedOrder = await recalcOrderTotal(orderId);
    return res.json({ message: "Item quantity updated ✅", order: updatedOrder });
  } catch (e) {
    console.error("updateOrderItemQuantity error:", e);
    return res.status(500).json({ message: "Error updating item quantity" });
  }
};
export const removeItemFromOrder = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.id);
    const itemId = Number(req.params.itemId);

    const item = await prisma.orderItem.findUnique({
      where: { id: itemId },
      include: { order: true },
    });
    if (!item || item.orderId !== orderId) {
      return res.status(404).json({ message: "OrderItem not found for this order" });
    }

    if (!assertScope(req, item.order.branchId)) {
      return res.status(403).json({ message: "Forbidden (branch scope)" });
    }
    if (item.order.status !== "PENDING") {
      return res.status(400).json({ message: "Cannot modify a non-PENDING order" });
    }

    await prisma.orderItem.delete({ where: { id: itemId } });

    const updatedOrder = await recalcOrderTotal(orderId);
    return res.json({ message: "Item removed 🗑️", order: updatedOrder });
  } catch (e) {
    console.error("removeItemFromOrder error:", e);
    return res.status(500).json({ message: "Error removing item" });
  }
};

// Helpers de respuesta uniforme
function invalidId(res: Response) {
  return res.status(400).json({ message: "Invalid order id" });
}
function notFound(res: Response) {
  return res.status(404).json({ message: "Order not found" });
}
function conflict(res: Response, msg = "Order is not pending") {
  return res.status(409).json({ message: msg });
}

/**
 * POST /api/orders/:id/pay
 * Reglas:
 *  - Solo si está PENDING
 *  - Cambia a PAID
 *  - (opcional) Libera la mesa a AVAILABLE
 */
 /* export const payOrder = async (req: any, res: any) => {
  const orderId = Number(req.params.id);
  const user = req.user as { id: number; role: Role; branchId?: number | null };

  // 1) RBAC: ¿puede este rol pagar?
  if (!can(user?.role, "ORDER_PAY")) {
    return res.status(403).json({ message: "Tu rol no puede pagar órdenes" });
  }

  // 2) Cargar la orden y su sede
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { table: true },
  });
  if (!order) return res.status(404).json({ message: "Orden no existe" });
  if (order.status !== "PENDING")
    return res.status(409).json({ message: "La orden no está en estado PENDING" });

  // 3) Alcance por sede: ADMIN solo en su sede
  const resourceBranchId = order.branchId ?? order.table?.branchId ?? null;
  if (user.role === "ADMIN") {
    if (user.branchId == null || resourceBranchId == null || user.branchId !== resourceBranchId) {
      return res.status(403).json({ message: "No tienes alcance sobre esta sede" });
    }
  }
  // MANAGER: sin restricción; CASHIER/WAITER: regla específica ya se aplicó arriba

  // 4) Transacción: marcar como pagada y liberar mesa
  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id: orderId },
      data: { status: "PAID" },
      include: { table: true },
    });

    // libera la mesa si corresponde
    if (o.tableId) {
      await tx.table.update({
        where: { id: o.tableId },
        data: { status: "AVAILABLE" },
      });
    }
    return o;
  });

  return res.json(updated);
}; */

/* export const cancelOrder = async (req: any, res: any) => {
  const orderId = Number(req.params.id);
  const user = req.user as { id: number; role: Role; branchId?: number | null };

  // 1) RBAC: ¿puede este rol cancelar?
  if (!can(user?.role, "ORDER_CANCEL")) {
    return res.status(403).json({ message: "Tu rol no puede cancelar órdenes" });
  }

  // 2) Cargar la orden con ítems y mesa
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, table: true },
  });
  if (!order) return res.status(404).json({ message: "Orden no existe" });
  if (order.status !== "PENDING")
    return res.status(409).json({ message: "La orden no está en estado PENDING" });

  // 3) Alcance por sede: ADMIN solo en su sede
  const resourceBranchId = order.branchId ?? order.table?.branchId ?? null;
  if (user.role === "ADMIN") {
    if (user.branchId == null || resourceBranchId == null || user.branchId !== resourceBranchId) {
      return res.status(403).json({ message: "No tienes alcance sobre esta sede" });
    }
  }

  // 4) Transacción: cancelar, devolver stock y liberar mesa
  const updated = await prisma.$transaction(async (tx) => {
    // Devolver stock
    for (const it of order.items) {
      await tx.product.update({
        where: { id: it.productId },
        data: { stockQty: { increment: it.quantity } },
      });
    }

    // Cancelar orden
    const o = await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
      include: { table: true },
    });

    // Liberar mesa
    if (o.tableId) {
      await tx.table.update({
        where: { id: o.tableId },
        data: { status: "AVAILABLE" },
      });
    }

    return o;
  });

  return res.json(updated);
}; */

export const addItemToOrder = async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const { productId, qty } = req.body as { productId?: number; qty?: number };
  const user = (req as any).user as { id: number; role: Role; branchId?: number | null };

  if (!can(user?.role, "ORDER_ITEM_ADD")) {
    return res.status(403).json({ message: "Tu rol no puede editar ítems" });
  }
  if (!Number.isFinite(productId) || !Number.isFinite(qty) || (qty as number) <= 0) {
    return res.status(400).json({ message: "productId/qty inválidos" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { table: true },
      });
      if (!order) return res.status(404).json({ message: "Orden no existe" }) as any;
      if (order.status !== "PENDING")
        return res.status(409).json({ message: "Orden no editable" }) as any;

      // Alcance ADMIN por sede
      const rBranch = getResourceBranchId(order);
      if (user.role === "ADMIN") {
        if (user.branchId == null || rBranch == null || user.branchId !== rBranch) {
          return res.status(403).json({ message: "No tienes alcance sobre esta sede" }) as any;
        }
      }

      const prod = await tx.product.findUnique({ where: { id: productId! } });
      if (!prod) return res.status(400).json({ message: "Producto no existe" }) as any;

      const unit = num(prod.price);
      if ((prod.stockQty ?? 0) < (qty as number)) {
        return res.status(409).json({ message: "Stock insuficiente" }) as any;
      }

      await tx.product.update({
        where: { id: productId! },
        data: { stockQty: { decrement: qty! } },
      });

      await tx.orderItem.create({
        data: {
          orderId,
          productId: productId!,
          quantity: qty!,
          unitPrice: String(unit),
          subtotal: String(unit * qty!),
        },
      });

      // Recalcular total y devolver orden con items
      const after = await recalcOrderTotal(orderId);
      return after as any;
    });

    // Si updated fue una Response (por error temprano en TX), ya devolvió
    if ((updated as any)?.status) return;
    return res.json(updated);
  } catch (err: any) {
    console.error("addItemToOrder error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateItemQty = async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { qty } = req.body as { qty?: number };
  const user = (req as any).user as { id: number; role: Role; branchId?: number | null };

  if (!can(user?.role, "ORDER_ITEM_UPDATE")) {
    return res.status(403).json({ message: "Tu rol no puede editar ítems" });
  }
  if (!Number.isFinite(qty) || (qty as number) <= 0) {
    return res.status(400).json({ message: "qty inválido" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { table: true } });
      if (!order) return res.status(404).json({ message: "Orden no existe" }) as any;
      if (order.status !== "PENDING")
        return res.status(409).json({ message: "Orden no editable" }) as any;

      const rBranch = getResourceBranchId(order);
      if (user.role === "ADMIN") {
        if (user.branchId == null || rBranch == null || user.branchId !== rBranch) {
          return res.status(403).json({ message: "No tienes alcance sobre esta sede" }) as any;
        }
      }

      const item = await tx.orderItem.findUnique({ where: { id: itemId } });
      if (!item || item.orderId !== orderId)
        return res.status(404).json({ message: "Item no existe" }) as any;

      const delta = (qty as number) - item.quantity;
      if (delta !== 0) {
        if (delta > 0) {
          // requiere más stock
          const prod = await tx.product.findUnique({ where: { id: item.productId } });
          const available = prod?.stockQty ?? 0;
          if (available < delta) {
            return res.status(409).json({ message: "Stock insuficiente" }) as any;
          }
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQty: { decrement: delta } },
          });
        } else {
          // devolver stock
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQty: { increment: -delta } }, // -delta es positivo
          });
        }
      }

      const unit = num(item.unitPrice);
      await tx.orderItem.update({
        where: { id: itemId },
        data: { quantity: qty!, subtotal: String(unit * qty!) },
      });

      const after = await recalcOrderTotal(orderId);
      return after as any;
    });

    if ((updated as any)?.status) return;
    return res.json(updated);
  } catch (err: any) {
    console.error("updateItemQty error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const removeItem = async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const user = (req as any).user as { id: number; role: Role; branchId?: number | null };

  if (!can(user?.role, "ORDER_ITEM_REMOVE")) {
    return res.status(403).json({ message: "Tu rol no puede editar ítems" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { table: true } });
      if (!order) return res.status(404).json({ message: "Orden no existe" }) as any;
      if (order.status !== "PENDING")
        return res.status(409).json({ message: "Orden no editable" }) as any;

      const rBranch = getResourceBranchId(order);
      if (user.role === "ADMIN") {
        if (user.branchId == null || rBranch == null || user.branchId !== rBranch) {
          return res.status(403).json({ message: "No tienes alcance sobre esta sede" }) as any;
        }
      }

      const item = await tx.orderItem.findUnique({ where: { id: itemId } });
      if (!item || item.orderId !== orderId)
        return res.status(404).json({ message: "Item no existe" }) as any;

      // devolver stock
      await tx.product.update({
        where: { id: item.productId },
        data: { stockQty: { increment: item.quantity } },
      });

      await tx.orderItem.delete({ where: { id: itemId } });

      const after = await recalcOrderTotal(orderId);
      return after as any;
    });

    if ((updated as any)?.status) return;
    return res.json(updated);
  } catch (err: any) {
    console.error("removeItem error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const payOrder = async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const user = (req as any).user as { id: number; role: Role; branchId?: number | null };

  if (!can(user?.role, "ORDER_PAY")) {
    return res.status(403).json({ message: "Tu rol no puede pagar órdenes" });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
  if (!order) return res.status(404).json({ message: "Orden no existe" });
  if (order.status !== "PENDING")
    return res.status(409).json({ message: "La orden no está en estado PENDING" });

  // Alcance por sede para ADMIN
  const rBranch = getResourceBranchId(order);
  if (user.role === "ADMIN") {
    if (user.branchId == null || rBranch == null || user.branchId !== rBranch) {
      return res.status(403).json({ message: "No tienes alcance sobre esta sede" });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id: orderId },
      data: { status: "PAID" },
      include: { table: true },
    });
    if (o.tableId) {
      await tx.table.update({ where: { id: o.tableId }, data: { status: "AVAILABLE" } });
    }
    return o;
  });

  return res.json(updated);
};

export const cancelOrder = async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const user = (req as any).user as { id: number; role: Role; branchId?: number | null };

  if (!can(user?.role, "ORDER_CANCEL")) {
    return res.status(403).json({ message: "Tu rol no puede cancelar órdenes" });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, table: true },
  });
  if (!order) return res.status(404).json({ message: "Orden no existe" });
  if (order.status !== "PENDING")
    return res.status(409).json({ message: "La orden no está en estado PENDING" });

  const rBranch = getResourceBranchId(order);
  if (user.role === "ADMIN") {
    if (user.branchId == null || rBranch == null || user.branchId !== rBranch) {
      return res.status(403).json({ message: "No tienes alcance sobre esta sede" });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // devolver stock
    for (const it of order.items) {
      await tx.product.update({
        where: { id: it.productId },
        data: { stockQty: { increment: it.quantity } },
      });
    }

    const o = await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
      include: { table: true },
    });

    if (o.tableId) {
      await tx.table.update({ where: { id: o.tableId }, data: { status: "AVAILABLE" } });
    }

    return o;
  });

  return res.json(updated);
};
