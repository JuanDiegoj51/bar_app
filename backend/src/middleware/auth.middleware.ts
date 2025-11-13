import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "secretkey123";

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // 🧩 Log para ver qué llega exactamente
  console.log("🔎 Headers:", req.headers);

  const authHeader = req.headers["authorization"];
  console.log("🔎 Authorization Header:", authHeader);

  const token = authHeader && authHeader.split(" ")[1];
  console.log("🔎 Extracted Token:", token);

  if (!token) {
    return res.status(401).json({ message: "Access denied. Token missing." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number };
    console.log("🔎 Decoded Token:", decoded);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("❌ Token verification error:", error);
    return res.status(403).json({ message: "Invalid or expired token." });
  }
};

