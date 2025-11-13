import { Router } from "express";
import {
  createTable,
  getAllTables,
  getTableById,
  updateTable,
  deleteTable,
} from "../controllers/table.controllers";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRole } from "../middleware/authorizeRole";

const router = Router();

// ✅ Todas requieren token, pero solo MANAGER puede modificar
router.get("/", authenticateToken, getAllTables);
router.get("/:id", authenticateToken, getTableById);
router.post("/", authenticateToken, authorizeRole(["MANAGER", "ADMIN"]), createTable);
router.put("/:id", authenticateToken, authorizeRole(["MANAGER", "ADMIN"]), updateTable);
router.delete("/:id", authenticateToken, authorizeRole(["MANAGER", "ADMIN"]), deleteTable);

export default router;
