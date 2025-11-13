import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../db/prismaClient";
import { can } from "../lib/rbac";

type Role = "WAITER" | "CASHIER" | "ADMIN" | "MANAGER";

function num(v: any): number {
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

async function recalcOrderTotal(orderId: number) {
  // Sumamos subtotales y guardamos total como string
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

function getResourceBranchId(order: any): number | null {
  return order?.branchId ?? order?.table?.branchId ?? null;
}

/**
 * GET /api/users
 * - MANAGER: lista todos
 * - ADMIN: lista solo usuarios de su branch
 * - Otros: 403
 */
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user as { id: number; role: Role; branchId?: number | null };
    if (!requester) return res.status(401).json({ message: "Unauthorized" });

    if (requester.role === "MANAGER") {
      const users = await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, branchId: true, createdAt: true },
        orderBy: { id: "asc" },
      });
      return res.json(users);
    }

    if (requester.role === "ADMIN") {
      if (!requester.branchId) {
        return res.status(403).json({ message: "Admin sin branch asignado" });
      }
      const users = await prisma.user.findMany({
        where: { branchId: requester.branchId },
        select: { id: true, name: true, email: true, role: true, branchId: true, createdAt: true },
        orderBy: { id: "asc" },
      });
      return res.json(users);
    }

    return res.status(403).json({ message: "Forbidden" });
  } catch (error) {
    console.error("getAllUsers error:", error);
    res.status(500).json({ message: "Error fetching users" });
  }
};

/**
 * GET /api/users/:id
 * - MANAGER: puede ver cualquiera
 * - ADMIN: solo si el usuario pertenece a su branch
 * - Otros: 403
 */
export const getUserById = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user as { id: number; role: Role; branchId?: number | null };
    if (!requester) return res.status(401).json({ message: "Unauthorized" });

    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, branchId: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (requester.role === "MANAGER") {
      return res.json(user);
    }

    if (requester.role === "ADMIN") {
      if (!requester.branchId || user.branchId !== requester.branchId) {
        return res.status(403).json({ message: "No tienes alcance sobre esta sede" });
      }
      return res.json(user);
    }

    return res.status(403).json({ message: "Forbidden" });
  } catch (error) {
    console.error("getUserById error:", error);
    res.status(500).json({ message: "Error fetching user" });
  }
};

/**
 * PATCH /api/users/:id
 * - Solo MANAGER
 * - MANAGER NO puede modificar a otros MANAGER (para evitar lockouts)
 * - ADMIN no puede cambiar roles/branch de nadie
 * - Si role = ADMIN, exigir branchId (para limitarlo a una sede)
 */
export const updateUserRole = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user as { id: number; role: Role; branchId?: number | null };
    if (!requester) return res.status(401).json({ message: "Unauthorized" });

    const targetId = Number(req.params.id);
    const { role, branchId } = req.body as { role?: string; branchId?: number };

    const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    // Solo MANAGER puede actualizar rol/branch
    if (requester.role !== "MANAGER") {
      return res.status(403).json({ message: "Only MANAGER can update users" });
    }

    // Por seguridad: no tocar a otros MANAGER
    if (targetUser.role === "MANAGER") {
      return res.status(403).json({ message: "Managers cannot modify other managers" });
    }

    const validRoles = ["MANAGER", "ADMIN", "WAITER", "CASHIER"];
    const normalizedRole = role ? role.toUpperCase() : undefined;
    if (normalizedRole && !validRoles.includes(normalizedRole)) {
      return res.status(400).json({ message: "Invalid role provided" });
    }

    // Si se convierte a ADMIN, exigir branchId
    if (normalizedRole === "ADMIN" && (branchId === undefined || branchId === null)) {
      return res.status(400).json({ message: "branchId es requerido para usuarios ADMIN" });
    }

    const updateData: any = {};
    if (normalizedRole) updateData.role = normalizedRole;
    if (branchId !== undefined) updateData.branchId = Number(branchId);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No valid fields provided" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetId },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, branchId: true },
    });

    return res.json({ message: "✅ User updated successfully", user: updatedUser });
  } catch (error) {
    console.error("updateUserRole error:", error);
    return res.status(500).json({ message: "Error updating user" });
  }
};

/**
 * DELETE /api/users/:id
 * - Solo MANAGER
 * - No borra MANAGER ni a sí mismo
 */
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user as { id: number; role: Role };
    if (!requester) return res.status(401).json({ message: "Unauthorized" });

    if (requester.role !== "MANAGER") {
      return res.status(403).json({ message: "Only MANAGER can delete users" });
    }

    const id = Number(req.params.id);
    if (id === requester.id) {
      return res.status(400).json({ message: "No puedes eliminarte a ti mismo" });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target.role === "MANAGER") {
      return res.status(403).json({ message: "No puedes eliminar a un MANAGER" });
    }

    await prisma.user.delete({ where: { id } });
    return res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("deleteUser error:", error);
    res.status(500).json({ message: "Error deleting user" });
  }
};

/**
 * POST /api/users
 * - Solo MANAGER
 * - MANAGER puede crear WAITER, CASHIER, MANAGER y ADMIN
 * - Si role = ADMIN, exigir branchId
 */
export const createUserByManager = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user as { id: number; role: Role };
    if (!requester) return res.status(401).json({ message: "Unauthorized" });

    if (requester.role !== "MANAGER") {
      return res.status(403).json({ message: "Only MANAGER can create users" });
    }

    const { name, email, password, role, branchId } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: Role;
      branchId?: number;
    };

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email y password son requeridos" });
    }

    const allowedRoles = new Set<Role>(["WAITER", "CASHIER", "MANAGER", "ADMIN"]);
    const finalRole: Role = role && allowedRoles.has(role) ? role : "WAITER";

    if (finalRole === "ADMIN" && (branchId === undefined || branchId === null)) {
      return res.status(400).json({ message: "branchId es requerido para usuarios ADMIN" });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ message: "Email ya registrado" });

    if (branchId !== undefined) {
      const branch = await prisma.branch.findUnique({ where: { id: Number(branchId) } });
      if (!branch) return res.status(400).json({ message: "branchId inválido" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const data: any = { name, email, passwordHash, role: finalRole };
    if (typeof branchId === "number") data.branchId = branchId;

    const created = await prisma.user.create({
      data,
      select: { id: true, name: true, email: true, role: true, branchId: true, createdAt: true },
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error("createUserByManager error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

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


