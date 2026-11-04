import { z } from "zod";
import { LIMITS } from "./contracts";

// Zod validation at every extension boundary: worker messages,
// capture results, and backend responses.

export const qualitySchema = z.object({
  code: z.enum(["complete", "partial", "unavailable"]),
  missingFields: z.array(z.string()).default([]),
  truncatedFields: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export const checkpointSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  createdAt: z.string().min(1),
  taskKey: z.string(),
  title: z.string().max(500),
  url: z.string().max(2000),
  adapter: z.enum(["generic", "leetcode"]),
  pageText: z.string().max(LIMITS.PAGE_TEXT_MAX),
  selectedText: z.string().max(LIMITS.SELECTED_MAX),
  code: z.string().max(LIMITS.CODE_MAX).nullable(),
  language: z.string().max(64).nullable(),
  quality: qualitySchema,
});

export const noteSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  title: z.string().max(300),
  body: z.string().max(50000),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  linkedCheckpointId: z.string().nullable(),
  kind: z.literal("codeOverride").optional(),
});

export const observedFactSchema = z.object({
  text: z.string().min(1).max(1000),
  sourceFields: z.array(z.string()).min(1).max(8),
});

export const summarySchema = z.object({
  recap: z.string().min(1).max(1200),
  observedFacts: z.array(observedFactSchema).max(20),
  possibleBlocker: z.string().max(600).nullable(),
  nextAction: z.string().min(1).max(600),
  uncertainties: z.array(z.string().max(500)).max(20),
});

export const summaryJobSchema = z.object({
  checkpointId: z.string().min(1),
  requestId: z.string().nullable(),
  status: z.enum(["idle", "pending", "complete", "failed"]),
  startedAt: z.string().nullable(),
  inputHash: z.string().nullable(),
  includedNoteSnapshots: z
    .array(z.object({ id: z.string(), revision: z.number().int(), body: z.string().max(50000), kind: z.literal("codeOverride").optional(), linkedCheckpointId: z.string().nullable().optional() }))
    .max(20),
  result: summarySchema.nullable(),
  error: z.object({ code: z.string(), message: z.string().max(1000) }).nullable(),
  warnings: z.array(z.string().max(500)).default([]),
});

export const workspaceSchema = z.object({
  openNoteIds: z.array(z.string()).max(100),
  activeNoteId: z.string().nullable(),
  selectedCheckpointId: z.string().nullable(),
  aiEnabled: z.boolean(),
  autoSummarize: z.boolean(),
  backendUrl: z.string().max(200),
});

export const workerCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("NOTE_CREATE"),
    title: z.string().max(300),
    linkedCheckpointId: z.string().min(1).max(200).nullable().optional(),
    body: z.string().max(50000).optional(),
    kind: z.literal("codeOverride").optional(),
  }),
  z.object({
    type: z.literal("NOTE_UPDATE"),
    id: z.string().min(1),
    baseRevision: z.number().int().nonnegative(),
    title: z.string().max(300),
    body: z.string().max(50000),
  }),
  z.object({ type: z.literal("NOTE_CLOSE"), id: z.string().min(1) }),
  z.object({ type: z.literal("NOTE_DELETE"), id: z.string().min(1) }),
  z.object({
    type: z.literal("WORKSPACE_UPDATE"),
    fields: z
      .object({
        openNoteIds: z.array(z.string()).max(100).optional(),
        activeNoteId: z.string().nullable().optional(),
        selectedCheckpointId: z.string().nullable().optional(),
        aiEnabled: z.boolean().optional(),
        autoSummarize: z.boolean().optional(),
        backendUrl: z.string().max(200).optional(),
      })
      .strict(),
  }),
  z.object({ type: z.literal("SUMMARY_BEGIN"), checkpointId: z.string().min(1), noteIds: z.array(z.string()).max(20) }),
  z.object({
    type: z.literal("SUMMARY_COMPLETE"),
    checkpointId: z.string().min(1),
    requestId: z.string().min(1),
    result: summarySchema,
  }),
  z.object({
    type: z.literal("SUMMARY_FAIL"),
    checkpointId: z.string().min(1),
    requestId: z.string().min(1),
    error: z.object({ code: z.string().max(64), message: z.string().max(1000) }),
  }),
  z.object({ type: z.literal("CHECKPOINT_DELETE"), id: z.string().min(1) }),
]);

export const backendSummaryResponseSchema = z.object({
  requestId: z.string().min(1),
  checkpointId: z.string().min(1),
  summary: summarySchema,
  model: z.string().max(200),
});

export type BackendSummaryResponse = z.infer<typeof backendSummaryResponseSchema>;
