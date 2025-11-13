import { Router } from "express";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRole } from "../middleware/authorizeRole";
import { getStockSummary, getStockByBranch } from "../controllers/stockSummary.controllers";

const router = Router();

router.use(authenticateToken);

// MANAGER y ADMIN acceden a estas vistas
router.get("/summary", authorizeRole(["MANAGER", "ADMIN"]), getStockSummary);
router.get("/by-branch", authorizeRole(["MANAGER", "ADMIN"]), getStockByBranch);

export default router;
