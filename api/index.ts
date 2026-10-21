import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../src/app.js";
import { connectDatabase } from "../src/db.js";

// Vercel serverless entry. The connection promise lives at module scope, so warm invocations
// reuse one MongoDB connection instead of reconnecting on every request.
let ready: Promise<void> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= connectDatabase().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  await ready;
  return app(req as never, res as never);
}
