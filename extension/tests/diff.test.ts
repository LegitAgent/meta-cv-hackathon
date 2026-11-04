import { describe, expect, it } from "vitest";
import { diffCheckpoints, MAX_CHANGED_LINES } from "../src/shared/diff";
import type { Checkpoint } from "../src/shared/contracts";

function cp(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "c1",
    schemaVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    taskKey: "example.com/task",
    title: "Task",
    url: "https://example.com/task",
    adapter: "generic",
    pageText: "page",
    selectedText: "",
    code: null,
    language: null,
    screenshot: null,
    stuckPoint: null,
    quality: { code: "complete", missingFields: [], truncatedFields: [], warnings: [] },
    ...overrides,
  } as Checkpoint;
}

describe("diffCheckpoints", () => {
  it("reports identical snapshots with zero counts", () => {
    const a = cp({ code: "x = 1\ny = 2\n" });
    const d = diffCheckpoints(a, cp({ id: "c2", createdAt: "2026-01-02T00:00:00.000Z", code: "x = 1\ny = 2\n" }));
    expect(d.sameTask).toBe(true);
    expect(d.codeAdded).toBe(0);
    expect(d.codeRemoved).toBe(0);
    expect(d.changedLines).toEqual([]);
    expect(d.summary).toContain("code identical");
  });

  it("counts added and removed lines in conventional order", () => {
    const a = cp({ code: "a\nb\nc" });
    const b = cp({ id: "c2", code: "a\nx\nc" });
    const d = diffCheckpoints(a, b);
    expect(d.codeAdded).toBe(1);
    expect(d.codeRemoved).toBe(1);
    expect(d.changedLines).toEqual([
      { type: "remove", text: "b" },
      { type: "add", text: "x" },
    ]);
  });

  it("flags different tasks while still diffing", () => {
    const d = diffCheckpoints(cp({ taskKey: "a.com/x" }), cp({ id: "c2", taskKey: "b.com/y" }));
    expect(d.sameTask).toBe(false);
    expect(d.summary).toContain("different tasks");
  });

  it("reports missing code instead of an empty diff", () => {
    const d = diffCheckpoints(cp({ code: "x = 1" }), cp({ id: "c2", code: null }));
    expect(d.summary).toContain("no code in one snapshot");
    expect(d.codeAdded).toBe(0);
    expect(d.codeRemoved).toBe(0);
    expect(d.changedLines).toEqual([]);
  });

  it("tracks title and page text changes", () => {
    const d = diffCheckpoints(
      cp({ title: "Before", pageText: "short" }),
      cp({ id: "c2", title: "After", pageText: "a much longer page" }),
    );
    expect(d.titleChanged).toBe(true);
    expect(d.pageTextDelta).toBeGreaterThan(0);
    expect(d.summary).toContain("title changed");
    expect(d.summary).toContain(`+${d.pageTextDelta} chars`);
  });

  it("caps rendered lines but counts the full diff", () => {
    const bCode = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    const d = diffCheckpoints(cp({ code: "base" }), cp({ id: "c2", code: bCode }));
    expect(d.codeAdded).toBe(60);
    expect(d.codeRemoved).toBe(1);
    expect(d.changedLines).toHaveLength(MAX_CHANGED_LINES);
  });
});
