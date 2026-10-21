import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const sessionCookie = "doctor_tracker_session";

declare global {
  namespace Express {
    interface Request {
      admin?: { email: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[sessionCookie];
  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    if (typeof payload.email !== "string") throw new Error("Invalid session");
    req.admin = { email: payload.email };
    next();
  } catch {
    res.clearCookie(sessionCookie, cookieOptions());
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  };
}
