import { env } from "../config/env.js";
import { HttpError } from "../utils/query.js";

export type Insight = { title: string; detail: string; tone: "positive" | "neutral" | "attention" };
type InsightResult = { insights: Insight[]; model: string; generatedAt: string };

const FALLBACK_MODEL = "gemini-flash-lite-latest";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const cache = new Map<string, { expires: number; value: InsightResult }>();

const responseSchema = {
  type: "OBJECT",
  properties: {
    insights: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          detail: { type: "STRING" },
          tone: { type: "STRING", enum: ["positive", "neutral", "attention"] },
        },
        required: ["title", "detail", "tone"],
      },
    },
  },
  required: ["insights"],
};

function buildPrompt(summary: unknown) {
  return [
    "You are an operations analyst for a medical clinic's admin dashboard.",
    "Using ONLY the aggregate statistics below, write 3 or 4 concise, specific insights an administrator can act on.",
    "Cover trends over time, workload balance across doctors, and care-status mix where the data supports it.",
    "Each title is at most 8 words. Each detail is one sentence of at most 30 words and cites the relevant numbers.",
    "Use tone 'attention' for imbalances or risks, 'positive' for healthy signals, otherwise 'neutral'.",
    "Do not invent data, give medical advice, or mention individual patients.",
    "",
    `Statistics (JSON): ${JSON.stringify(summary)}`,
  ].join("\n");
}

async function callGemini(model: string, prompt: string): Promise<Insight[]> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.4 },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Gemini ${model} ${response.status}: ${payload?.error?.message ?? "request failed"}`);

  const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") ?? "";
  const parsed = JSON.parse(text) as { insights?: Insight[] };
  const insights = (parsed.insights ?? []).filter((item) => item?.title && item?.detail).slice(0, 4);
  if (!insights.length) throw new Error(`Gemini ${model} returned no insights`);
  return insights;
}

/**
 * Generates dashboard insights from aggregate statistics only (no patient-level data leaves the API).
 * Results are cached per key to stay within free-tier rate limits, and a second model is tried when
 * the primary is overloaded or unavailable.
 */
export async function generateInsights(cacheKey: string, summary: unknown): Promise<InsightResult> {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "AI insights are not configured.");

  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const prompt = buildPrompt(summary);
  const models = [...new Set([env.GEMINI_MODEL, FALLBACK_MODEL])];
  for (const model of models) {
    try {
      const value = { insights: await callGemini(model, prompt), model, generatedAt: new Date().toISOString() };
      cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
      return value;
    } catch (error) {
      console.warn("AI insights attempt failed:", error instanceof Error ? error.message : error);
    }
  }
  throw new HttpError(502, "AI insights are temporarily unavailable. Please try again shortly.");
}
