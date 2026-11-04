import { z } from "zod";

const boundedList = z.array(z.string().max(500)).max(20).default([]);
export const requestSchema = z.object({
  requestId: z.string().min(1).max(200),
  checkpoint: z.object({
    id: z.string().min(1).max(200), title: z.string().max(500),
    pageText: z.string().max(20000), selectedText: z.string().max(5000).default(""),
    code: z.string().max(30000).nullable().default(null),
    language: z.string().max(64).nullable().default(null),
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
