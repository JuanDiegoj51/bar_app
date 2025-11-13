import { Request, Response } from "express";
import prisma from "../db/prismaClient"; // Asegúrate de tener esta instancia de Prisma
import { can, Role } from "../lib/rbac"

// 🧱 Crear mesa
/* export const createTable = async (req: Request, res: Response) => {
  try {
    const { number, capacity, status, branchId } = req.body;

    const newTable = await prisma.table.create({
      data: {
        number,
        capacity,
        status: status || "AVAILABLE",
        branchId,
      },
    });

    res.status(201).json({
      message: "Table created successfully ✅",
      table: newTable,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating table" });
  }
}; */

export const getAllTables = async (req: Request, res: Response) => {
  try {
    const requester = req.user; // viene del token

    if (!requester) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let tables;

    // ✅ Si es MANAGER → puede ver todas las mesas
    if (requester.role === "MANAGER") {
      tables = await prisma.table.findMany({
        include: { branch: true },
      });
    } 
    // ✅ Si es ADMIN → solo las mesas de su branch
    else if (requester.role === "ADMIN") {
      tables = await prisma.table.findMany({
        where: { branchId: requester.branchId ?? undefined },
        include: { branch: true },
      });
    } 
    // ❌ Otros roles no pueden
    else {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.json(tables);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching tables" });
  }
};


// 🔍 Obtener una mesa por ID
export const getTableById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const table = await prisma.table.findUnique({
      where: { id: Number(id) },
      include: { branch: true },
    });

    if (!table) {
      return res.status(404).json({ message: "Table not found" });
    }

    res.json(table);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching table" });
  }
};

// ✏️ Actualizar mesa
export const updateTable = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { number, capacity, status, branchId } = req.body;

    const updated = await prisma.table.update({
      where: { id: Number(id) },
      data: { number, capacity, status, branchId },
    });

    res.json({ message: "Table updated successfully ✅", table: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating table" });
  }
};

// 🗑️ Eliminar mesa
/* export const deleteTable = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.table.delete({ where: { id: Number(id) } });

    res.json({ message: "Table deleted successfully 🗑️" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting table" });
  }
}; */

// Crear mesa (ADMIN solo en su branch; MANAGER en cualquiera)
export const createTable = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user as { id: number; role: Role; branchId?: number | null };
    if (!can(requester?.role, "TABLE_CREATE")) {
      return res.status(403).json({ message: "No puedes crear mesas" });
    }

    const { number, capacity, branchId } = req.body as {
      number?: number; capacity?: number; branchId?: number;
    };

    if (!Number.isFinite(number) || !Number.isFinite(capacity)) {
      return res.status(400).json({ message: "number y capacity son requeridos (numéricos)" });
    }

    let finalBranchId: number | null = null;
    if (requester.role === "MANAGER") {
      if (!Number.isFinite(branchId)) return res.status(400).json({ message: "branchId es requerido" });
      finalBranchId = Number(branchId);
    } else { // ADMIN
      if (requester.branchId == null) {
        return res.status(403).json({ message: "ADMIN sin branch asignado" });
      }
      finalBranchId = requester.branchId!;
    }

    // Validar que no exista mesa (#) en ese branch
    const dup = await prisma.table.findFirst({ where: { number: Number(number), branchId: finalBranchId! } });
    if (dup) return res.status(409).json({ message: "Ya existe una mesa con ese número en la sede" });

    const created = await prisma.table.create({
      data: {
        number: Number(number),
        capacity: Number(capacity),
        status: "AVAILABLE",
        branchId: finalBranchId!,
      },
    });
    return res.status(201).json(created);
  } catch (err) {
    console.error("createTable error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Eliminar mesa (ADMIN solo su branch; MANAGER cualquiera) — solo si no hay orden PENDING en esa mesa
export const deleteTable = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user as { id: number; role: Role; branchId?: number | null };
    if (!can(requester?.role, "TABLE_DELETE")) {
      return res.status(403).json({ message: "No puedes eliminar mesas" });
    }

    const id = Number(req.params.id);
    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) return res.status(404).json({ message: "Mesa no existe" });

    if (requester.role === "ADMIN") {
      if (requester.branchId == null || requester.branchId !== table.branchId) {
        return res.status(403).json({ message: "No tienes alcance sobre esta sede" });
      }
    }

    const pending = await prisma.order.findFirst({
      where: { tableId: id, status: "PENDING" },
      select: { id: true },
    });
    if (pending) {
      return res.status(409).json({ message: "No puedes eliminar una mesa con una orden PENDING" });
    }

    await prisma.table.delete({ where: { id } });
    return res.json({ message: "Mesa eliminada" });
  } catch (err) {
    console.error("deleteTable error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
