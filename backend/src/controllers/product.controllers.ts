import { Request, Response } from "express";
import prisma from "../db/prismaClient";

/**
 * Crear producto
 * - MANAGER: puede crear en cualquier branch (usa branchId del body)
 * - ADMIN: fuerza branchId = req.user.branchId (ignora el del body)
 */
export const createProduct = async (req: Request, res: Response) => {
  try {
    const requester = req.user!;
    const { name, description, price, status, branchId } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ message: "name and price are required" });
    }

    // Regla de sede por rol
    let targetBranchId: number | undefined;
    if (requester.role === "MANAGER") {
      if (!branchId) return res.status(400).json({ message: "branchId is required for MANAGER" });
      targetBranchId = Number(branchId);
    } else if (requester.role === "ADMIN") {
      if (!requester.branchId) {
        return res.status(400).json({ message: "ADMIN has no branch assigned" });
      }
      targetBranchId = requester.branchId;
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }

    const product = await prisma.product.create({
      data: {
        name,
        description,
        price: String(price), // Prisma Decimal acepta string/Decimal
        status: status || "ACTIVE",
        branchId: targetBranchId,
      },
    });

    return res.status(201).json({ message: "Product created ✅", product });
  } catch (error) {
    console.error("createProduct error:", error);
    return res.status(500).json({ message: "Error creating product" });
  }
};

/**
 * Listar productos
 * - MANAGER: ve todos
 * - ADMIN: solo su branch
 */
export const getProducts = async (req: Request, res: Response) => {
  try {
    const requester = req.user!;

    let where: any = {};
    if (requester.role === "ADMIN") {
      if (!requester.branchId) {
        return res.status(400).json({ message: "ADMIN has no branch assigned" });
      }
      where.branchId = requester.branchId;
    } else if (requester.role === "MANAGER") {
      // sin filtro (todas las sedes)
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }

    const products = await prisma.product.findMany({
      where,
      include: { branch: true },
      orderBy: { createdAt: "desc" },
    });

    return res.json(products);
  } catch (error) {
    console.error("getProducts error:", error);
    return res.status(500).json({ message: "Error fetching products" });
  }
};

/**
 * Obtener 1 producto por id (respetando sede por rol)
 */
export const getProductById = async (req: Request, res: Response) => {
  try {
    const requester = req.user!;
    const id = Number(req.params.id);

    const product = await prisma.product.findUnique({
      where: { id },
      include: { branch: true },
    });

    if (!product) return res.status(404).json({ message: "Product not found" });

    if (requester.role === "ADMIN") {
      if (!requester.branchId || requester.branchId !== product.branchId) {
        return res.status(403).json({ message: "Forbidden" });
      }
    } else if (requester.role !== "MANAGER") {
      return res.status(403).json({ message: "Forbidden" });
    }

    return res.json(product);
  } catch (error) {
    console.error("getProductById error:", error);
    return res.status(500).json({ message: "Error fetching product" });
  }
};

/**
 * Actualizar producto
 * - ADMIN: solo su branch
 * - MANAGER: cualquier branch
 */
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const requester = req.user!;
    const id = Number(req.params.id);
    const { name, description, price, status, branchId } = req.body;

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Product not found" });

    // Autorización por sede
    if (requester.role === "ADMIN") {
      if (!requester.branchId || requester.branchId !== existing.branchId) {
        return res.status(403).json({ message: "Forbidden" });
      }
    } else if (requester.role !== "MANAGER") {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Si es ADMIN, NO puede mover productos a otra branch
    let targetBranchId = existing.branchId;
    if (requester.role === "MANAGER" && branchId !== undefined) {
      targetBranchId = Number(branchId);
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        description: description ?? existing.description,
        price: price !== undefined ? String(price) : existing.price,
        status: status ?? existing.status,
        branchId: targetBranchId,
      },
      include: { branch: true },
    });

    return res.json({ message: "Product updated ✅", product: updated });
  } catch (error) {
    console.error("updateProduct error:", error);
    return res.status(500).json({ message: "Error updating product" });
  }
};

/**
 * Eliminar producto
 * - ADMIN: solo su branch
 * - MANAGER: cualquier branch
 */
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const requester = req.user!;
    const id = Number(req.params.id);

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Product not found" });

    if (requester.role === "ADMIN") {
      if (!requester.branchId || requester.branchId !== existing.branchId) {
        return res.status(403).json({ message: "Forbidden" });
      }
    } else if (requester.role !== "MANAGER") {
      return res.status(403).json({ message: "Forbidden" });
    }

    await prisma.product.delete({ where: { id } });
    return res.json({ message: "Product deleted 🗑️" });
  } catch (error) {
    console.error("deleteProduct error:", error);
    return res.status(500).json({ message: "Error deleting product" });
  }
};
