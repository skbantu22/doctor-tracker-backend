import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { cookieOptions, requireAuth, sessionCookie } from "../middleware/auth.js";

const router = Router();
const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) });
const adminPasswordHash = bcrypt.hashSync(env.ADMIN_PASSWORD, 12);

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });

  const { email, password } = parsed.data;
  const passwordMatches = await bcrypt.compare(password, adminPasswordHash);
  if (email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase() || !passwordMatches) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }

  const token = jwt.sign({ email: env.ADMIN_EMAIL.toLowerCase() }, env.JWT_SECRET, { expiresIn: "8h" });
  res.cookie(sessionCookie, token, cookieOptions());
  return res.json({ admin: { email: env.ADMIN_EMAIL.toLowerCase() } });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(sessionCookie, cookieOptions());
  res.status(204).end();
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ admin: req.admin });
});

export default router;
