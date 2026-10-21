import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD: z.string().min(12),
  FRONTEND_URL: z.url(),
  // Optional: enables AI dashboard insights. Without it the endpoint returns 503 and the UI hides the card.
  GEMINI_API_KEY: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional()),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash-lite"),
});

export const env = schema.parse(process.env);
