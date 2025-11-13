import { Request, Response } from "express";
import prisma from "../db/prismaClient";
import { can, Role } from "../lib/rbac";

const assertScope = (req: Request, targetBranchId: number) => {
  const u = req.user!;
  if (u.role === "MANAGER") return true;
  if (!u.branchId) return false;
  return u.branchId === targetBranchId;
};

/**
 * POST /api/stock/adjust
 * Body: { productId, quantity, type: "IN"|"OUT"|"ADJUST", reason? }
 * - MANAGER: puede ajustar productos de cualquier branch
 * - ADMIN: solo productos de su branch
 */
/* export const adjustStock = async (req: Request, res: Response) => {
  try {
    const u = req.user!;
    const { productId, quantity, type, reason } = req.body as {
      productId?: number;
      quantity?: number;
      type?: "IN" | "OUT" | "ADJUST";
      reason?: string;
    };

    if (!productId || !quantity || !type) {
      return res.status(400).json({ message: "productId, quantity and type are required" });
    }
    if (!["IN", "OUT", "ADJUST"].includes(type)) {
      return res.status(400).json({ message: "Invalid movement type" });
    }

    const product = await prisma.product.findUnique({ where: { id: Number(productId) } });
    if (!product) return res.status(404).json({ message: "Product not found" });

    if (!assertScope(req, product.branchId)) {
      return res.status(403).json({ message: "Forbidden (branch scope)" });
    }

    // Calcula el nuevo stock
    let newQty = product.stockQty;
    if (type === "IN") newQty += Number(quantity);
    if (type === "OUT") newQty -= Number(quantity);
    if (type === "ADJUST") newQty = Number(quantity); // ADJUST = set directo

    if (newQty < 0) {
      return res.status(409).json({ message: "Insufficient stock to perform OUT movement" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.product.update({
        where: { id: product.id },
        data: { stockQty: newQty },
      });

      await tx.stockMovement.create({
        data: {
          type,
          quantity: Number(quantity),
          reason: reason ?? null,
          productId: product.id,
          branchId: product.branchId,
          createdById: u.id,
          // orderId: null (cuando es ajuste manual)
        },
      });

      return p;
    });

    return res.json({ message: "Stock adjusted ✅", product: updated });
  } catch (e) {
    console.error("adjustStock error:", e);
    return res.status(500).json({ message: "Error adjusting stock" });
  }
}; */

/**
 * GET /api/stock/movements?productId=&limit=50
 * - MANAGER: ve todos
 * - ADMIN: solo su branch
 */
export const getStockMovements = async (req: Request, res: Response) => {
  try {
    const u = req.user!;
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    let where: any = {};
    if (productId) where.productId = productId;

    if (u.role !== "MANAGER") {
      if (!u.branchId) {
        return res.status(400).json({ message: "User has no branch assigned" });
      }
      where.branchId = u.branchId;
    }

    const rows = await prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        product: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, role: true } },
        order: { select: { id: true, status: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    return res.json(rows);
  } catch (e) {
    console.error("getStockMovements error:", e);
    return res.status(500).json({ message: "Error fetching stock movements" });
  }
};

export const adjustStock = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user as { id: number; role: Role; branchId?: number | null };
    if (!can(requester?.role, "STOCK_ADJUST")) {
      return res.status(403).json({ message: "No puedes ajustar stock" });
    }

    const { productId, delta, reason } = req.body as { productId?: number; delta?: number; reason?: string };
    if (!Number.isFinite(productId) || !Number.isFinite(delta)) {
      return res.status(400).json({ message: "productId y delta son requeridos (numéricos)" });
    }

    const prod = await prisma.product.findUnique({ where: { id: Number(productId) } });
    if (!prod) return res.status(404).json({ message: "Producto no existe" });

    // Alcance por sede: ADMIN/CASHIER solo en su branch; MANAGER en todas
    if (requester.role === "ADMIN" || requester.role === "CASHIER") {
      if (requester.branchId == null || prod.branchId == null || requester.branchId !== prod.branchId) {
        return res.status(403).json({ message: "No tienes alcance sobre esta sede" });
      }
    }

    const next = (prod.stockQty ?? 0) + Number(delta);
    if (next < 0) return res.status(409).json({ message: "El stock no puede quedar negativo" });

    const updated = await prisma.product.update({
      where: { id: prod.id },
      data: { stockQty: next },
    });

    // (Opcional) guardar un log de movimiento de stock si tienes tabla
    // await prisma.stockMovement.create({ data: { productId: prod.id, delta: Number(delta), reason: reason ?? null, byUserId: requester.id } });

    return res.json({ message: "Stock actualizado", product: updated });
  } catch (err) {
    console.error("adjustStock error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
