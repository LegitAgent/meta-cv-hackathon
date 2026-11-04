// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getResumeStack, ResumeView } from "../src/panel/components/ResumeView";
import { Repository, type AsyncStorageArea } from "../src/storage/repository";
import type { Checkpoint } from "../src/shared/contracts";

function cp(id: string, taskKey: string, createdAt: string): Checkpoint {
  return {
    id, schemaVersion: 1, createdAt, taskKey, title: `Title ${id}`,
    url: "https://example.com/page", adapter: "generic", pageText: "page",
    selectedText: "", code: "x=1", language: "python", screenshot: null, stuckPoint: null,
    quality: { code: "complete", missingFields: [], truncatedFields: [], warnings: [] },
  };
}

const base = cp("c1", "example.com/page", "2026-02-03T00:00:00.000Z");

function renderView(all: Checkpoint[], selected: Checkpoint) {
  const related = getResumeStack(all, selected);
  const onOpen = vi.fn();
  render(
    <ResumeView checkpoint={selected} job={null} related={related} onCapture={() => undefined}
      capturing={false} onSummarize={() => undefined} onCopyCode={() => undefined}
      onOpenSource={() => undefined} onOpenCheckpoint={onOpen} busy={false}
      autoSummarize={false} onAutoSummarize={() => undefined} onPasteCode={async () => true} pasteError={null} />,
  );
  return onOpen;
}

describe("resume stack", () => {
  it("lists newest same-task saves first, excluding selected and other tasks", () => {
    const all = [
      base,
      cp("c2", "example.com/page", "2026-02-02T00:00:00.000Z"),
      cp("c3", "example.com/page", "2026-02-01T00:00:00.000Z"),
      cp("c4", "other.com/x", "2026-02-04T00:00:00.000Z"),
    ];
    const stack = getResumeStack(all, base);
    expect(stack.map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("reopens a related save without touching saved code", () => {
    const all = [base, cp("c2", "example.com/page", "2026-02-02T00:00:00.000Z")];
    const onOpen = renderView(all, base);
    fireEvent.click(screen.getByRole("button", { name: "Title c2" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe("c2");
  });

  it("records a resume event without mutating the checkpoint", async () => {
    const store: Record<string, unknown> = { "checkpoint:c1": base };
    const area: AsyncStorageArea = {
      get: async (keys) => {
        if (keys === null) return { ...store };
        return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]));
      },
      set: async (items) => { Object.assign(store, items); },
      remove: async (keys) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k]; },
    };
    const repo = new Repository(area);
    expect(await repo.recordResume("c1")).toBe(true);
    expect(await repo.recordResume("missing")).toBe(false);
    const events = Object.values(store).filter((v) => (v as { type?: string }).type === "checkpoint.resumed");
    expect(events).toHaveLength(1);
    expect(store["checkpoint:c1"]).toBe(base);
  });
});
