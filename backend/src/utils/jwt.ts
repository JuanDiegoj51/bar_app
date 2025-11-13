import jwt from "jsonwebtoken";

export function signAccessToken(payload: object) {
  const secret = process.env.JWT_ACCESS_SECRET as string;
  const expiresIn = process.env.ACCESS_TOKEN_EXP || "15m";
  return jwt.sign(payload, secret, { expiresIn });
}

export function signRefreshToken(payload: object) {
  const secret = process.env.JWT_REFRESH_SECRET as string;
  const expiresIn = process.env.REFRESH_TOKEN_EXP || "7d";
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET as string);
}
