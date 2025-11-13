import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { Request, Response } from "express";
import { generateToken } from "../utils/generateToken";
import {
  cookieOpts,
  newJti,
  refreshSessions,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/authTokens";


const prisma = new PrismaClient();

// ✅ Registro de usuario
export const registerUser = async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;

    // Verificar si el usuario ya existe
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Encriptar contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Crear usuario en la base de datos (CORREGIDO)
    const user = await prisma.user.create({
      data: { name, email, passwordHash: hashedPassword, role },
    });

    res.status(201).json({ message: "User registered successfully", user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Login de usuario
export const loginUser = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    console.log("[loginUser] start", { email });

    // Buscar usuario por email
    const user = await prisma.user.findUnique({ where: { email } });
    console.log("[loginUser] user", { found: !!user, id: user?.id });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Validar que el esquema tiene passwordHash
    if (!user.passwordHash) {
      console.error("[loginUser] user.passwordHash is missing");
      return res.status(500).json({ message: "Server error (passwordHash missing)" });
    }

    // Comparar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    console.log("[loginUser] passwordValid", isPasswordValid);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generar ACCESS TOKEN (el tuyo)
    const accessToken = generateToken(user.id, user.role);
    console.log("[loginUser] accessToken generated");

    // REFRESH en cookie httpOnly
    const payload = {
      sub: String(user.id),
      role: user.role,
      name: user.name,
      email: user.email,
    };

    // Asegúrate de tener ../lib/authTokens.ts creado
    const jti = newJti();
    const refreshToken = signRefreshToken({ ...payload, jti });
    refreshSessions.set(payload.sub, jti);

    res.cookie("refresh_token", refreshToken, cookieOpts());
    console.log("[loginUser] refresh cookie set");

    return res.json({
      message: "Login successful",
      accessToken,
      token: accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error: any) {
    console.error("[loginUser] error", error?.stack || error);
    return res.status(500).json({ message: "Server error", detail: error?.message });
  }
};

/** ✅ Logout: elimina refresh token y limpia cookie httpOnly */
export const logoutUser = async (req: Request, res: Response) => {
  try {
    const refreshToken = (req as any).cookies?.refreshToken;

    // Si tienes tabla RefreshToken, elimina la fila de ese token
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }

    // Limpia la cookie
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return res.json({ message: "Logged out" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};