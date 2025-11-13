import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Crear sucursal
export const createBranch = async (req: Request, res: Response) => {
  try {
    const { name, location } = req.body;
    const branch = await prisma.branch.create({
      data: { name, location },
    });
    res.status(201).json(branch);
  } catch (error) {
    console.error("Error al crear branch:", error);
    res.status(500).json({ error: "Error al crear branch" });
  }
};

// Obtener todas las sucursales
export const getBranches = async (_req: Request, res: Response) => {
  try {
    const branches = await prisma.branch.findMany();
    res.json(branches);
  } catch (error) {
    console.error("Error al obtener branches:", error);
    res.status(500).json({ error: "Error al obtener branches" });
  }
};

// Obtener una sucursal por ID
export const getBranchById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const branch = await prisma.branch.findUnique({
      where: { id: Number(id) },
      include: { tables: true, users: true },
    });
    if (!branch) return res.status(404).json({ error: "Branch no encontrada" });
    res.json(branch);
  } catch (error) {
    console.error("Error al obtener branch:", error);
    res.status(500).json({ error: "Error al obtener branch" });
  }
};

// Actualizar sucursal
export const updateBranch = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, location } = req.body;
    const branch = await prisma.branch.update({
      where: { id: Number(id) },
      data: { name, location },
    });
    res.json(branch);
  } catch (error) {
    console.error("Error al actualizar branch:", error);
    res.status(500).json({ error: "Error al actualizar branch" });
  }
};

// Eliminar sucursal
export const deleteBranch = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.branch.delete({ where: { id: Number(id) } });
    res.json({ message: "Branch eliminada correctamente" });
  } catch (error) {
    console.error("Error al eliminar branch:", error);
    res.status(500).json({ error: "Error al eliminar branch" });
  }
};
