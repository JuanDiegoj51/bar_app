export type Role = "WAITER" | "CASHIER" | "ADMIN" | "MANAGER";
type Action =
  | "ORDER_PAY"
  | "ORDER_CANCEL"
  | "ORDER_ITEM_ADD"
  | "ORDER_ITEM_UPDATE"
  | "ORDER_ITEM_REMOVE"
  | "TABLE_CREATE"   
  | "TABLE_DELETE"     
  | "STOCK_ADJUST";    

export function can(role: Role | undefined, action: Action): boolean {
  if (!role) return false;

  switch (action) {
    case "ORDER_PAY":
    case "ORDER_CANCEL":
      if (role === "WAITER") return false;
      return role === "CASHIER" || role === "ADMIN" || role === "MANAGER";

    case "ORDER_ITEM_ADD":
    case "ORDER_ITEM_UPDATE":
    case "ORDER_ITEM_REMOVE":
      return role === "WAITER" || role === "CASHIER" || role === "ADMIN" || role === "MANAGER";

    // ⬇️ Mesas: solo ADMIN y MANAGER
    case "TABLE_CREATE":
    case "TABLE_DELETE":
      return role === "ADMIN" || role === "MANAGER";

    // ⬇️ Stock: ADMIN, MANAGER y CASHIER
    case "STOCK_ADJUST":
      return role === "ADMIN" || role === "MANAGER" || role === "CASHIER";

    default:
      return false;
  }
}


