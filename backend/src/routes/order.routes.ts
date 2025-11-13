import { Router } from "express";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRole } from "../middleware/authorizeRole";
import {
    createOrder,
    getOrders,
    getOrderById,
    updateOrderStatus,
    updateOrderItemQuantity,
    removeItemFromOrder,
    addItemToOrder,
    updateItemQty,
    removeItem,
} from "../controllers/order.controllers";
import { payOrder, cancelOrder } from "../controllers/order.controllers";


const router = Router();

// Todas requieren estar autenticado
router.use(authenticateToken);

// Crear pedido (ADMIN/WAITER solo su branch; MANAGER cualquiera)
router.post("/", authorizeRole(["MANAGER", "ADMIN", "WAITER"]), createOrder);

// Consultas
router.get("/", authorizeRole(["MANAGER", "ADMIN", "CASHIER", "WAITER"]), getOrders);
router.get("/:id", authorizeRole(["MANAGER", "ADMIN", "CASHIER", "WAITER"]), getOrderById);

// Cambiar estado
router.put("/:id/status", authorizeRole(["MANAGER", "ADMIN", "CASHIER"]), updateOrderStatus);
router.put("/:id/items/:itemId", authorizeRole(["MANAGER", "ADMIN", "WAITER"]), updateOrderItemQuantity);

// Eliminar item  
router.delete("/:id/items/:itemId", authorizeRole(["MANAGER", "ADMIN", "WAITER"]), removeItemFromOrder);

// Pagar / Cancelar orden (ADMIN, MANAGER, CASHIER)
router.post("/:id/pay",authenticateToken, authorizeRole(["ADMIN", "MANAGER", "CASHIER"]), payOrder);
router.post("/:id/cancel", authenticateToken, authorizeRole(["ADMIN", "MANAGER", "CASHIER"]), cancelOrder);
router.post("/:id/items", authenticateToken, addItemToOrder);
router.patch("/:id/items/:itemId", authenticateToken, updateItemQty);
router.delete("/:id/items/:itemId", authenticateToken, removeItem);
export default router;
