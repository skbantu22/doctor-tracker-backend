import type { Request } from "express";
import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reads a single string query parameter, ignoring arrays and trimming to a sane length. */
export function queryString(req: Request, key: string, maxLength = 80) {
  const value = req.query[key];
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function parsePagination(req: Request) {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, "Invalid pagination parameters.");
  return parsed.data;
}

export function pageMeta(page: number, limit: number, total: number) {
  return { page, limit, total, pages: Math.ceil(total / limit) };
}

/** Builds a createdAt range from `from`/`to` (YYYY-MM-DD) query params; `to` is inclusive. */
export function dateRangeFilter(req: Request) {
  const from = queryString(req, "from", 30);
  const to = queryString(req, "to", 30);
  if ((from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) {
    throw new HttpError(400, "Invalid date filter.");
  }
  const createdAt: { $gte?: Date; $lte?: Date } = {};
  if (from) createdAt.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setUTCHours(23, 59, 59, 999);
    createdAt.$lte = end;
  }
  if (createdAt.$gte && createdAt.$lte && createdAt.$gte > createdAt.$lte) {
    throw new HttpError(400, "The start date must be before the end date.");
  }
  return Object.keys(createdAt).length ? { createdAt } : {};
}

/**
 * Lowercased word tokens stored on each document. Searching them with an anchored,
 * case-sensitive regex lets MongoDB use tight bounds on the multikey `keywords` index,
 * which a case-insensitive regex across several fields cannot do.
 */
export function buildKeywords(...values: (string | undefined | null)[]) {
  const tokens = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const lower = value.toLowerCase().trim();
    tokens.add(lower);
    for (const token of lower.split(/[\s,@.+()\-/]+/)) if (token) tokens.add(token);
  }
  return [...tokens];
}

/** Every search term must prefix-match at least one keyword. */
export function keywordFilter(search: string) {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!terms.length) return {};
  return { $and: terms.map((term) => ({ keywords: { $regex: `^${escapeRegex(term)}` } })) };
}
