import { describe, expect, it } from "vitest";
import { buildLeetCodeOutcome } from "../src/capture/leetcode";
import {
  mergeSavedNote,
  resolveAdoptedDraft,
  shouldClaimSaved,
  shouldRetrySave,
  toLastCaptureRecord,
} from "../src/panel/store";
import { buildSummaryPayload } from "../src/shared/payload";
import type { Checkpoint } from "../src/shared/contracts";

describe("autosave merge", () => {
  const serverNote = {
    id: "n1",
    revision: 4,
    title: "Saved title",
    body: "saved body",
    createdAt: "t",
    updatedAt: "t",
    linkedCheckpointId: null,
    folderId: null,
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

describe("draft ownership across notes", () => {
  const noteA = { id: "a", title: "A", body: "saved a", revision: 3 };
  const noteB = { id: "b", title: "B", body: "saved b", revision: 7 };

  it("never shows another note's pending text", () => {
    const draft = resolveAdoptedDraft(noteB, { id: "a", title: "typing a", body: "typing a" });
    expect(draft).toEqual({ id: "b", title: "B", body: "saved b", baseRevision: 7 });
  });

  it("keeps pending text for the incoming note under its revision", () => {
    const draft = resolveAdoptedDraft(noteA, { id: "a", title: "typing a", body: "typing a" });
    expect(draft).toEqual({ id: "a", title: "typing a", body: "typing a", baseRevision: 3 });
  });

  it("clears the draft when there is no incoming note", () => {
    expect(resolveAdoptedDraft(null, { id: "a", title: "x", body: "x" })).toEqual({
      id: null,
      title: "",
      body: "",
      baseRevision: 0,
    });
  });
});

describe("save coordination", () => {
  it("never auto-retries a conflict, even with text waiting", () => {
    expect(shouldRetrySave(true, true)).toBe(false);
    expect(shouldRetrySave(true, false)).toBe(false);
  });

  it("retries transient failures only when text is still waiting", () => {
    expect(shouldRetrySave(false, true)).toBe(true);
    expect(shouldRetrySave(false, false)).toBe(false);
  });

  it("claims Saved only when the outbox is empty", () => {
    expect(shouldClaimSaved(0)).toBe(true);
    expect(shouldClaimSaved(2)).toBe(false);
  });
});

describe("summary payload from snapshots", () => {
  const checkpoint = {
    id: "c1",
    schemaVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    taskKey: "x",
    title: "Two Sum",
    url: "https://leetcode.com/problems/two-sum/",
    adapter: "leetcode",
    pageText: "Given an array...",
    selectedText: "",
    code: "x = 1",
    language: "python",
    screenshot: null,
    stuckPoint: null,
    quality: { code: "partial", missingFields: [], truncatedFields: [], warnings: [] },
  } as Checkpoint;

  it("sends the persisted snapshots and matching request id, not live notes", () => {
    const snapshots = [{ id: "n1", revision: 2, body: "tried dict" }];
    const { payload, warnings } = buildSummaryPayload(checkpoint, "r-1", snapshots);
    expect(payload.requestId).toBe("r-1");
    expect(payload.checkpoint.id).toBe("c1");
    expect(payload.notes).toEqual([{ id: "n1", body: "tried dict" }]);
    expect(warnings).toEqual([]);
  });

  it("caps the aggregate note budget and labels every trim", () => {
    const snapshots = [
      { id: "n1", revision: 0, body: "x".repeat(9000) },
      { id: "n2", revision: 0, body: "y".repeat(9000) },
    ];
    const { payload, warnings } = buildSummaryPayload(checkpoint, "r-2", snapshots);
    const total = payload.notes.reduce((n, note) => n + note.body.length, 0);
    expect(total).toBeLessThanOrEqual(10000);
    expect(payload.notes[0].body).toBe("x".repeat(9000));
    expect(payload.notes[1].body.length).toBe(1000);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(" ")).toMatch(/10,000-character/);
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
