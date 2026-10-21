import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { requireAuth } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import doctorRoutes from "./routes/doctors.js";
import patientRoutes from "./routes/patients.js";
import { HttpError } from "./utils/query.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
// Behind the Next.js rewrite every request arrives from the frontend host, so login attempts are limited
// per submitted account rather than per IP. Successful sign-ins don't count towards the limit.
app.use("/api/auth/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254) || "anonymous",
  message: { error: "Too many sign-in attempts. Please wait 15 minutes and try again." },
}));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api", requireAuth);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/patients", patientRoutes);

app.use((_req, res) => res.status(404).json({ error: "Endpoint not found." }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) });
  }
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: "Check the submitted details and try again." });
  }
  if (error && typeof error === "object" && "type" in error && error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  if (error && typeof error === "object" && "code" in error && error.code === 11000) {
    return res.status(409).json({ error: "A record with this email already exists." });
  }
  console.error(error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
});
