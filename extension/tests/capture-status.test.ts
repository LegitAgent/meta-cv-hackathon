import { describe, expect, it } from "vitest";
import { buildLeetCodeOutcome } from "../src/capture/leetcode";
import { mergeSavedNote, toLastCaptureRecord } from "../src/panel/store";

describe("autosave merge", () => {
  const serverNote = {
    id: "n1",
    revision: 4,
    title: "Saved title",
    body: "saved body",
    createdAt: "t",
    updatedAt: "t",
    linkedCheckpointId: null,
  };

  it("keeps newer typing on success while adopting the new revision", () => {
    const draft = mergeSavedNote(serverNote, { title: "Newer title", body: "newer body" });
    expect(draft.baseRevision).toBe(4);
    expect(draft.title).toBe("Newer title");
    expect(draft.body).toBe("newer body");
  });

  it("adopts the server note when nothing newer was typed", () => {
    const draft = mergeSavedNote(serverNote, null);
    expect(draft).toEqual({ id: "n1", title: "Saved title", body: "saved body", baseRevision: 4 });
  });
});

describe("capture status record", () => {
  it("records successful captures with the checkpoint id", () => {
    const rec = toLastCaptureRecord({ ok: true, data: { checkpoint: { id: "c1" } } }, "2026-01-01T00:00:00.000Z");
    expect(rec).toEqual({ ok: true, at: "2026-01-01T00:00:00.000Z", checkpointId: "c1", code: null, message: null });
  });

  it("records failures with code and message", () => {
    const rec = toLastCaptureRecord(
      { ok: false, error: { code: "SCRIPT_DENIED", message: "denied" } },
      "2026-01-01T00:00:00.000Z",
    );
    expect(rec.ok).toBe(false);
    expect(rec.checkpointId).toBeNull();
    expect(rec.code).toBe("SCRIPT_DENIED");
    expect(rec.message).toBe("denied");
  });
});

describe("leetcode problem text", () => {
  it("prefers the extracted problem statement over generic page text", () => {
    const out = buildLeetCodeOutcome({
      title: "Two Sum",
      url: "https://leetcode.com/problems/two-sum/",
      selectedText: "",
      pageText: "generic shell text",
      pageTextFromProblem: "Given an array of integers nums...",
      code: "x = 1",
      language: "python",
      codePartial: true,
      missingFields: [],
      truncatedFields: [],
      warnings: [],
    });
    expect(out.pageText).toContain("Given an array");
    expect(out.pageText).not.toContain("generic shell");
  });
});
