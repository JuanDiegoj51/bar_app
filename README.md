# Restaurant/Bar API (Node + Express + Prisma + PostgreSQL)

Backend para gestión de restaurante/bar **multisede**, con:
- **Auth JWT + Refresh + Logout**
- **Roles**: MANAGER, ADMIN, WAITER, CASHIER
- **Branches** (sedes) y **Tables** (mesas)
- **Products** por sede
- **Orders** con **OrderItems**, estados `PENDING/PAID/CANCELLED`
- **Stock** con `stockQty` y **StockMovements** (IN/OUT/ADJUST)
- **Reportes**: resumen de stock y stock por sede
- **Swagger UI** para documentación y pruebas

## Stack
- Node 18+, TypeScript, Express
- Prisma ORM + PostgreSQL
- JWT (access) + Refresh tokens (cookie/httpOnly o en body para pruebas)
- Swagger UI

## Requisitos
- Node 18+ y npm
- PostgreSQL en local
- Archivo `.env` en `/backend` con:
