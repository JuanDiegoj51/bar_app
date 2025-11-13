import express = require("express");
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import tableRoutes from "./routes/table.routes";
import branchRoutes from "./routes/branch.routes";
import productRoutes from "./routes/product.routes";
import orderRoutes from "./routes/order.routes";
import stockRoutes from "./routes/stock.routes";
import stockSummaryRoutes from "./routes/stockSummary.routes";
import path from "path";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();
 
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(cookieParser()); // ← añade esta línea
// ... CORS y luego tus rutas

// --- INICIO BLOQUE NUEVO (añadir arriba del archivo) ---

type Role = "MANAGER" | "ADMIN" | "WAITER" | "CASHIER";
type JwtPayload = { sub: string; role: Role; name: string; email: string; jti?: string };

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "dev_access_secret";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev_refresh_secret";
const ACCESS_TTL_SECONDS = Number(process.env.ACCESS_TTL_SECONDS || 900);      // 15 min
const REFRESH_TTL_SECONDS = Number(process.env.REFRESH_TTL_SECONDS || 1209600);// 14 días
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || "localhost";
const IS_PROD = process.env.NODE_ENV === "production";

// helpers de JWT
function signAccessToken(p: Omit<JwtPayload, "jti">) {
  return jwt.sign(p, ACCESS_SECRET, { expiresIn: ACCESS_TTL_SECONDS });
}
function signRefreshToken(p: Omit<JwtPayload, "jti"> & { jti: string }) {
  return jwt.sign(p, REFRESH_SECRET, { expiresIn: REFRESH_TTL_SECONDS, jwtid: p.jti });
}
function verifyRefreshToken(token: string) {
  return jwt.verify(token, REFRESH_SECRET) as JwtPayload & { jti: string };
}
function cookieOpts() {
  return {
    httpOnly: true,
    secure: IS_PROD,       // en dev sin https puede ir false
    sameSite: "lax" as const,
    domain: COOKIE_DOMAIN, // en dev "localhost"
    path: "/",
    maxAge: REFRESH_TTL_SECONDS * 1000,
  };
}
// rotación simple por usuario: userId -> jti actual
const refreshSessions = new Map<string, string>();
const newJti = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
// --- FIN BLOQUE NUEVO ---


app.use(
  cors({
    origin: "http://localhost:3000", // tu frontend
    credentials: true,               // para cookies (refresh)
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET","POST","PUT","DELETE","OPTIONS"]
  })
);


// 👉 SWAGGER UI
// 1) Construimos la ruta absoluta al YAML. process.cwd() = raíz donde ejecutas `npm run dev`.
const swaggerPath = path.join(process.cwd(), "/docs", "openapi.yaml");

// 2) Cargamos el YAML como objeto JS.
const swaggerDoc = YAML.load(swaggerPath);

// 3) Montamos la UI en /docs. persistAuthorization: true mantiene tu token al refrescar.
app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDoc, {
    swaggerOptions: { persistAuthorization: true },
  })
);


// 👇 Aquí conectamos las rutas de autenticación
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/stock", stockSummaryRoutes);



app.get("/", (req, res) => {
  res.send("Restaurant API is running 🍽️");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

