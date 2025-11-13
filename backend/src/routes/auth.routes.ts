import { Router } from "express";
import { registerUser, loginUser } from "../controllers/auth.controllers";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRole } from "../middleware/authorizeRole";
import { logoutUser } from "../controllers/auth.controllers";
import { cookieOpts } from "../lib/authTokens";
import {
  verifyRefreshToken,
  signAccessToken,
  newJti,
  signRefreshToken,
  refreshSessions,
} from "../lib/authTokens";
import { generateToken } from "../utils/generateToken";

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);

// ✅ Ruta protegida (solo con token válido)
router.get("/profile", authenticateToken, (req, res) => {
  res.json({ message: "Access granted ✅", user: req.user });
});

// ✅ Nueva ruta protegida — solo para ADMIN o MANAGER
router.get(
  "/admin",
  authenticateToken,
  authorizeRole(["ADMIN", "MANAGER"]),
  (req, res) => {
    res.json({
      message: "Welcome to the admin area 👑",
      user: req.user,
    });
  }
);

router.post("/refresh", (req, res) => {
  const token = (req as any).cookies?.["refresh_token"];
  if (!token) return res.status(401).json({ message: "No refresh cookie" });

  try {
    const decoded = verifyRefreshToken(token);
    const { sub: userId, role, name, email, jti } = decoded;

    const currentJti = refreshSessions.get(userId);
    if (!currentJti || currentJti !== jti) {
      return res.status(401).json({ message: "Invalid refresh session" });
    }

    const payload = { sub: userId, role, name, email };
    const newAccessToken = generateToken(Number(userId), role as any);

    // Rotar refresh
    const nextJti = newJti();
    const newRefreshToken = signRefreshToken({ ...payload, jti: nextJti });
    refreshSessions.set(userId, nextJti);

    res.cookie("refresh_token", newRefreshToken, cookieOpts());
    return res.json({ accessToken: newAccessToken });
  } catch {
    return res.status(401).json({ message: "Invalid refresh token" });
  }
});
// DEBUG: setear una cookie httpOnly simple para validar CORS/cookie-parser
router.post("/debug-set-cookie", (req, res) => {
  res.cookie("refresh_token", "test_cookie_value", cookieOpts());
  return res.json({ ok: true, note: "refresh_token set via cookie" });
});
export default router;
