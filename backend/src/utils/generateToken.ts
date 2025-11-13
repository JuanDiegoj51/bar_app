import jwt from "jsonwebtoken";

export const generateToken = (userId: number, role: string) => {
  const secret = process.env.JWT_SECRET || "secretkey"; // ⚠️ Usar variable de entorno real en producción

  return jwt.sign(
    { id: userId, role },
    secret,
    { expiresIn: "1d" } // Token válido por 1 día
  );
};
