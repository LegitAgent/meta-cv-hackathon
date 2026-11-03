import { describe, expect, it } from "vitest";
import {
  checkpointSchema,
  summarySchema,
  workerCommandSchema,
  backendSummaryResponseSchema,
} from "../src/shared/validation";

const goodSummary = {
  recap: "Saved attempt uses a dict.",
  observedFacts: [{ text: "The code creates a dict.", sourceFields: ["code"] }],
  possibleBlocker: null,
  nextAction: "Trace the loop with one small input.",
  uncertainties: ["No test results were captured."],
};

describe("validation boundaries", () => {
  it("rejects oversized pageText", () => {
    const r = checkpointSchema.safeParse({
      id: "c1",
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
      taskKey: "x",
      title: "t",
      url: "https://example.com/",
      adapter: "generic",
      pageText: "x".repeat(20001),
      selectedText: "",
      code: null,
      language: null,
      quality: { code: "complete", missingFields: [], truncatedFields: [], warnings: [] },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid summary and rejects invented-shape output", () => {
    expect(summarySchema.safeParse(goodSummary).success).toBe(true);
    expect(summarySchema.safeParse({ ...goodSummary, recap: "" }).success).toBe(false);
    expect(summarySchema.safeParse({ ...goodSummary, nextAction: "" }).success).toBe(false);
  });

  it("rejects unknown worker commands and untrusted shapes", () => {
    expect(workerCommandSchema.safeParse({ type: "DELETE_EVERYTHING" }).success).toBe(false);
    expect(
      workerCommandSchema.safeParse({ type: "WORKSPACE_UPDATE", fields: { admin: true } }).success,
    ).toBe(false);
    expect(
      workerCommandSchema.safeParse({ type: "NOTE_CREATE", title: "ok" }).success,
    ).toBe(true);
    expect(
      workerCommandSchema.safeParse({
        type: "NOTE_CREATE",
        title: "Pasted code",
        linkedCheckpointId: "c1",
        body: "x = 1",
      }).success,
    ).toBe(true);
    expect(
      workerCommandSchema.safeParse({ type: "NOTE_CREATE", title: "ok", body: "x".repeat(50001) }).success,
    ).toBe(false);
  });

  it("validates backend responses strictly", () => {
    expect(
      backendSummaryResponseSchema.safeParse({
        requestId: "r1",
        checkpointId: "c1",
        summary: goodSummary,
        model: "m",
      }).success,
    ).toBe(true);
    expect(
      backendSummaryResponseSchema.safeParse({ requestId: "r1", summary: goodSummary, model: "m" }).success,
    ).toBe(false);
  });
});
