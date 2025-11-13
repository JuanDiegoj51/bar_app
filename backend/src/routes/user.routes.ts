import { Router } from "express";
import {
  getAllUsers,
  getUserById,
  updateUserRole,
  deleteUser,
  createUserByManager
} from "../controllers/user.controllers";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRole } from "../middleware/authorizeRole";

const router = Router();

// ✅ Solo ADMIN o MANAGER pueden listar usuarios
router.get("/", authenticateToken, authorizeRole(["ADMIN", "MANAGER"]), getAllUsers);

// ✅ Cualquier usuario autenticado puede ver su propio perfil (o MANAGER ver a otros)
router.get("/:id", authenticateToken, getUserById);

// ✅ Solo MANAGER puede actualizar roles
router.put("/:id", authenticateToken, authorizeRole(["MANAGER"]), updateUserRole);

// ✅ Solo MANAGER puede eliminar usuarios
router.delete("/:id", authenticateToken, authorizeRole(["MANAGER"]), deleteUser);

// Solo MANAGER puede crear usuarios
router.post("/", authenticateToken, authorizeRole(["MANAGER"]), createUserByManager);

export default router;
