import dotenv from "dotenv";
dotenv.config();

import jwt from "jsonwebtoken";

export type Role = "MANAGER" | "ADMIN" | "WAITER" | "CASHIER";
export type JwtPayload = { sub: string; role: Role; name: string; email: string; jti?: string };

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "dev_access_secret";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev_refresh_secret";
const ACCESS_TTL_SECONDS = Number(process.env.ACCESS_TTL_SECONDS || 900);       // 15 min
const REFRESH_TTL_SECONDS = Number(process.env.REFRESH_TTL_SECONDS || 1209600); // 14 días
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || "localhost";
const IS_PROD = process.env.NODE_ENV === "production";

export function signAccessToken(p: Omit<JwtPayload, "jti">) {
  return jwt.sign(p, ACCESS_SECRET, { expiresIn: ACCESS_TTL_SECONDS });
}

export function signRefreshToken(p: Omit<JwtPayload, "jti"> & { jti: string }) {
  // Importante: NO pasar { jwtid: p.jti } porque ya incluimos 'jti' en el payload
  return jwt.sign(p, REFRESH_SECRET, { expiresIn: REFRESH_TTL_SECONDS });
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, REFRESH_SECRET) as JwtPayload & { jti: string };
}

export function cookieOpts() {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax" as const,
    domain: COOKIE_DOMAIN,
    path: "/",
    maxAge: REFRESH_TTL_SECONDS * 1000,
  };
}

export const refreshSessions = new Map<string, string>(); // userId -> jti vigente

export const newJti = () => Math.random().toString(36).slice(2) + Date.now().toString(36);