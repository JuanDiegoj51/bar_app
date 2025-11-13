import { Router } from "express";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRole } from "../middleware/authorizeRole";
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} from "../controllers/product.controllers";

const router = Router();

// Lectura (ADMIN ve su branch, MANAGER ve todo)
router.get("/", authenticateToken, authorizeRole(["ADMIN", "MANAGER"]), getProducts);
router.get("/:id", authenticateToken, authorizeRole(["ADMIN", "MANAGER"]), getProductById);

// Escritura
router.post("/", authenticateToken, authorizeRole(["ADMIN", "MANAGER"]), createProduct);
router.put("/:id", authenticateToken, authorizeRole(["ADMIN", "MANAGER"]), updateProduct);
router.delete("/:id", authenticateToken, authorizeRole(["ADMIN", "MANAGER"]), deleteProduct);

export default router;
