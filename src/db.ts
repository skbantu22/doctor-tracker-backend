import mongoose from "mongoose";
import { env } from "./config/env.js";
import { Doctor } from "./models/Doctor.js";
import { Patient } from "./models/Patient.js";

let connection: Promise<void> | undefined;

/**
 * Connects once per process and shares the promise. Serverless instances (Vercel) call this on the
 * first request and reuse the connection while warm; a failed attempt is retried on the next request.
 */
export function ensureDatabase() {
  connection ??= connectDatabase().catch((error: unknown) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
  await backfillKeywords();
}

/** Records created before keyword search existed get their search tokens on startup. */
async function backfillKeywords() {
  let updated = 0;
  for (const model of [Doctor, Patient]) {
    for await (const doc of model.find({ keywords: { $exists: false } }).cursor()) {
      await doc.save();
      updated += 1;
    }
  }
  if (updated) console.log(`Search keywords backfilled for ${updated} records.`);
}
