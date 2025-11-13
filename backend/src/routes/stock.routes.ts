import { Router } from "express";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRole } from "../middleware/authorizeRole";
import { adjustStock, getStockMovements } from "../controllers/stock.controllers";

const router = Router();

router.use(authenticateToken);

// MANAGER y ADMIN pueden ajustar (con reglas por branch)
router.post("/adjust", authorizeRole(["MANAGER", "ADMIN"]), adjustStock);

// Ver movimientos
router.get("/movements", authorizeRole(["MANAGER", "ADMIN"]), getStockMovements);

export default router;
