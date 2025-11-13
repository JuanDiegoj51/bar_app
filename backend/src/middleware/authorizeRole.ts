import { Request, Response, NextFunction } from "express";

/**
 * Middleware para verificar si el usuario tiene un rol autorizado.
 * @param roles Lista de roles permitidos para acceder a la ruta.
 */
export const authorizeRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Si por alguna razón no hay usuario autenticado
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Si el rol del usuario no está dentro de los roles permitidos
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient permissions" });
    }

    // Todo bien → continuar
    next();
  };
};
