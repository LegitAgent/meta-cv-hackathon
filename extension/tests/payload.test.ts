import { describe, expect, it } from "vitest";
import { buildSummaryPayload } from "../src/shared/payload";
import { LIMITS, type Checkpoint } from "../src/shared/contracts";

function cp(): Checkpoint {
  return {
    id: "c-1",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    taskKey: "example.com/page",
    title: "Page",
    url: "https://example.com/page",
    adapter: "generic",
    pageText: "text",
    selectedText: "",
    code: null,
    language: null,
    screenshot: null,
    quality: { code: "complete", missingFields: [], truncatedFields: [], warnings: [] },
  };
}

// Locks the R3 contract: the aggregate note budget is enforced with a
// warning per trimmed note, never by silent truncation.
describe("summary payload budget", () => {
  it("trims a single oversized note and warns", () => {
    const { payload, warnings } = buildSummaryPayload(cp(), "r-1", [
      { id: "n-1", revision: 1, body: "x".repeat(15000) },
    ]);
    const total = payload.notes.reduce((n, x) => n + x.body.length, 0);
    expect(total).toBeLessThanOrEqual(LIMITS.NOTES_TOTAL_MAX);
    expect(payload.notes).toHaveLength(1);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("n-1");
  });

  it("leaves notes that fit the budget untouched and quiet", () => {
    const { payload, warnings } = buildSummaryPayload(cp(), "r-1", [
      { id: "n-1", revision: 1, body: "short" },
    ]);
    expect(payload.notes).toEqual([{ id: "n-1", body: "short" }]);
    expect(warnings).toEqual([]);
  });

  it("passes the screenshot through to the checkpoint payload", () => {
    const shot = "data:image/jpeg;base64," + "s".repeat(1000);
    const { payload } = buildSummaryPayload({ ...cp(), screenshot: shot }, "r-3", []);
    expect(payload.checkpoint.screenshot).toBe(shot);
  });

  it("uses selected pasted code as code without spending the note budget", () => {
    const checkpoint = { ...cp(), code: "partial code", quality: { ...cp().quality, code: "partial" as const } };
    const { payload, warnings } = buildSummaryPayload(checkpoint, "r-2", [
      { id: "code", revision: 0, body: "x".repeat(35000), kind: "codeOverride", linkedCheckpointId: checkpoint.id },
      { id: "note", revision: 0, body: "my note", linkedCheckpointId: null },
    ]);
    expect(payload.checkpoint.code).toBe("x".repeat(LIMITS.CODE_MAX));
    expect(payload.checkpoint.quality.warnings).toContain("Code for this recap came from a pasted note and replaces captured code.");
    expect(payload.notes).toEqual([{ id: "note", body: "my note" }]);
    expect(warnings.some((w) => w.includes("trimmed"))).toBe(true);
    expect(checkpoint.code).toBe("partial code");
  });
});
