import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./db.js";

async function start() {
  await connectDatabase();
  const server = app.listen(env.PORT, () => console.log(`Doctor Tracker API listening on port ${env.PORT}`));
  // Keep idle sockets open longer than upstream proxies (Next.js rewrites, load balancers) so they never
  // reuse a connection Node has just closed, which surfaces as ECONNRESET / 502 on the client.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

start().catch((error: unknown) => {
  console.error("Unable to start Doctor Tracker API", error);
  process.exit(1);
});
