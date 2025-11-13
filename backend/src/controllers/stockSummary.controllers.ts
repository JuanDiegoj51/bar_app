import { Request, Response } from "express";
import prisma from "../db/prismaClient";

const LOW_STOCK_THRESHOLD = 5; // puedes moverlo a .env si quieres

const scopeFilter = (req: Request) => {
  const u = req.user!;
  if (u.role === "MANAGER") return {};                 // global
  if (!u.branchId) throw new Error("User has no branch assigned");
  return { branchId: u.branchId };                    // sólo su sede
};

export const getStockSummary = async (req: Request, res: Response) => {
  try {
    const u = req.user!;
    const where = scopeFilter(req);

    const [activeProducts, totalUnits, lowStock] = await Promise.all([
      prisma.product.count({ where: { status: "ACTIVE", ...where } }),
      prisma.product.aggregate({
        _sum: { stockQty: true },
        where
      }),
      prisma.product.findMany({
        where: { status: "ACTIVE", stockQty: { lt: LOW_STOCK_THRESHOLD }, ...where },
        select: {
          id: true, name: true, stockQty: true, branchId: true,
          branch: { select: { name: true } }
        },
        orderBy: { stockQty: "asc" }
      })
    ]);

    const scopeLabel = u.role === "MANAGER"
      ? "GLOBAL"
      : `BRANCH:${u.branchId}`;

    res.json({
      scope: scopeLabel,
      totals: {
        activeProducts,
        totalUnits: totalUnits._sum.stockQty ?? 0
      },
      lowStock: lowStock.map(i => ({
        productId: i.id,
        name: i.name,
        stockQty: i.stockQty,
        branchId: i.branchId,
        branch: i.branch?.name ?? null
      }))
    });
  } catch (e: any) {
    const msg = e.message?.includes("User has no branch") ? e.message : "Error building stock summary";
    console.error("getStockSummary error:", e);
    res.status(500).json({ message: msg });
  }
};

export const getStockByBranch = async (req: Request, res: Response) => {
  try {
    const u = req.user!;
    let branchId: number | undefined;

    if (u.role === "MANAGER") {
      branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    } else {
      if (!u.branchId) {
        return res.status(400).json({ message: "User has no branch assigned" });
      }
      branchId = u.branchId; // ADMIN forzado a su sede
    }

    const where = branchId ? { branchId } : {};
    const products = await prisma.product.findMany({
      where,
      select: {
        id: true, name: true, stockQty: true, status: true, branchId: true,
        branch: { select: { name: true } }
      },
      orderBy: [{ branchId: "asc" }, { name: "asc" }]
    });

    // Si se filtró branchId, devolvemos cabecera de branch; si no, agrupamos por sede
    if (branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId } });
      return res.json({
        branchId,
        branch: branch?.name ?? null,
        items: products.map(p => ({
          productId: p.id, name: p.name, stockQty: p.stockQty, status: p.status
        }))
      });
    }

    // MANAGER sin branchId: agrupamos por sede
    const grouped: Record<number, { branch: string | null; items: any[] }> = {};
    for (const p of products) {
      const key = p.branchId;
      if (!grouped[key]) grouped[key] = { branch: p.branch?.name ?? null, items: [] };
      grouped[key].items.push({ productId: p.id, name: p.name, stockQty: p.stockQty, status: p.status });
    }

    res.json(grouped);
  } catch (e) {
    console.error("getStockByBranch error:", e);
    res.status(500).json({ message: "Error fetching stock by branch" });
  }
};
