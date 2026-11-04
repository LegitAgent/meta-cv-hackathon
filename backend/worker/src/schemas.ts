import { z } from "zod";

const boundedList = z.array(z.string().max(500)).max(20).default([]);
export const requestSchema = z.object({
  requestId: z.string().min(1).max(200),
  checkpoint: z.object({
    id: z.string().min(1).max(200), title: z.string().max(500),
    pageText: z.string().max(20000), selectedText: z.string().max(5000).default(""),
    code: z.string().max(30000).nullable().default(null),
    language: z.string().max(64).nullable().default(null),
    screenshot: z.string().max(120000).refine(s => s.startsWith("data:image/"), "Screenshot must be a data:image URL.").nullable().default(null),
    stuckPoint: z.string().max(500).nullable().default(null),
    quality: z.object({
      code: z.enum(["complete", "partial", "unavailable"]),
      missingFields: boundedList, truncatedFields: boundedList, warnings: boundedList,
    }),
  }),
  notes: z.array(z.object({ id: z.string().min(1).max(200), body: z.string().max(10000) })).max(20).default([]),
}).refine(v => v.notes.reduce((n, x) => n + x.body.length, 0) <= 10000, "Notes exceed aggregate limit");

export const summarySchema = z.object({
  recap: z.string().min(1).max(1200),
  observedFacts: z.array(z.object({ text: z.string().min(1).max(1000), sourceFields: z.array(z.string().max(100)).min(1).max(8) })).max(20).default([]),
  possibleBlocker: z.string().max(600).nullable().default(null),
  nextAction: z.string().min(1).max(600), uncertainties: boundedList,
});
export type SummaryInput = z.infer<typeof requestSchema>;

// Models often wrap JSON in fences or return slightly overlong fields.
// Extract the payload and coerce repairable shapes (truncation, dropped
// invalid list items) so those responses validate instead of failing.
// Core content (recap/nextAction) is never invented: empty stays empty.
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) return fence[1].trim();
  if (trimmed.startsWith("{")) {
    const end = trimmed.lastIndexOf("}");
    if (end > 0) return trimmed.slice(0, end + 1);
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function cleanStrings(value: unknown, itemMax: number, listMax: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t) continue;
    out.push(t.length > itemMax ? t.slice(0, itemMax) : t);
    if (out.length >= listMax) break;
  }
  return out;
}

export function sanitizeSummary(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const facts: unknown[] = Array.isArray(v.observedFacts) ? v.observedFacts.slice(0, 20) : [];
  const cleanFacts = [];
  for (const f of facts) {
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    if (typeof o.text !== "string" || !o.text.trim()) continue;
    const rawSources = typeof o.sourceFields === "string" ? [o.sourceFields] : o.sourceFields;
    const sources = cleanStrings(rawSources, 100, 8);
    if (sources.length === 0) continue;
    const text = o.text.trim();
    cleanFacts.push({ text: text.length > 1000 ? text.slice(0, 1000) : text, sourceFields: sources });
    if (cleanFacts.length >= 20) break;
  }
  const recap = typeof v.recap === "string" ? v.recap.trim() : v.recap;
  const nextAction = typeof v.nextAction === "string" ? v.nextAction.trim() : v.nextAction;
  let blocker = v.possibleBlocker ?? null;
  if (typeof blocker === "string") {
    const t = blocker.trim();
    blocker = t ? (t.length > 600 ? t.slice(0, 600) : t) : null;
  } else if (blocker !== null) {
    blocker = null;
  }
  return {
    ...v,
    recap: typeof recap === "string" && recap.length > 1200 ? recap.slice(0, 1200) : recap,
    observedFacts: cleanFacts,
    possibleBlocker: blocker,
    nextAction: typeof nextAction === "string" && nextAction.length > 600 ? nextAction.slice(0, 600) : nextAction,
    uncertainties: cleanStrings(v.uncertainties, 500, 20),
  };
}

// Generate the provider contract from the same schema used to validate responses.
export const summaryResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "backtrack_summary", strict: true,
    schema: z.toJSONSchema(summarySchema, { io: "output", target: "draft-7" }),
  },
};
