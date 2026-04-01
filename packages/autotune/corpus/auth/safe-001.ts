// @description Proper server-side JWT verification with secret key

import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env["JWT_SECRET"];
if (!JWT_SECRET) throw new Error("JWT_SECRET env var required");

export interface TokenPayload {
  userId: string;
  role: "user" | "admin" | "moderator";
  iat: number;
  exp: number;
}

// Correct: uses jwt.verify() which validates signature + expiry server-side.
// An attacker cannot forge the payload without the secret.
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
