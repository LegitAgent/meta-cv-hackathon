import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Checkpoint } from "../src/shared/contracts";

function cp(id: string, taskKey: string, createdAt: string): Checkpoint {
  return {
    id, schemaVersion: 1, createdAt, taskKey, title: id,
    url: `https://${taskKey}`, adapter: "generic",
    pageText: "p", selectedText: "", code: null, language: null, screenshot: null, stuckPoint: null,
    quality: { code: "complete", missingFields: [], truncatedFields: [], warnings: [] },
  };
}

let tabUrls: Record<number, string | undefined>;
let activated: ((info: { tabId: number; windowId: number }) => void) | undefined;
let updated: ((tabId: number, info: { status?: string; url?: string }) => void) | undefined;

async function loadBackground() {
  const bg = await import("../src/background");
  if (!activated) throw new Error("onActivated listener was not registered");
  if (!updated) throw new Error("onUpdated listener was not registered");
  return bg;
}

function setup() {
  tabUrls = {};
  activated = undefined;
  updated = undefined;
  const records: Record<string, unknown> = {
    workspace: { openNoteIds: [], activeNoteId: null, selectedCheckpointId: "old", aiEnabled: false, autoSummarize: false, backendUrl: "http://127.0.0.1:8001" },
    "checkpoint:old": cp("old", "example.com/task", "2026-01-01T00:00:00.000Z"),
    "checkpoint:new": cp("new", "example.com/task", "2026-02-01T00:00:00.000Z"),
  };
  const chromeMock = {
    runtime: { id: "test-extension", lastError: undefined, onMessage: { addListener: vi.fn() } },
    action: { onClicked: { addListener: vi.fn() } },
    tabs: {
      get: vi.fn(async (tabId: number) => {
        const url = tabUrls[tabId];
        if (url === undefined) throw new Error("no tab");
        return { id: tabId, url };
      }),
      query: vi.fn(async () => Object.entries(tabUrls).map(([id, url]) => ({ id: Number(id), url }))),
      onActivated: { addListener: (fn: NonNullable<typeof activated>) => { activated = fn; } },
      onUpdated: { addListener: (fn: NonNullable<typeof updated>) => { updated = fn; } },
    },
    storage: { local: {
      get: (keys: string[] | null, callback?: (value: Record<string, unknown>) => void) => {
        const value = keys === null ? { ...records } : Object.fromEntries(keys.filter((key) => key in records).map((key) => [key, records[key]]));
        callback?.(value);
        return Promise.resolve(value);
      },
      set: (items: Record<string, unknown>, callback?: () => void) => {
        Object.assign(records, items);
        callback?.();
        return Promise.resolve();
      },
      remove: (keys: string[] | string, callback?: () => void) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete records[key];
        callback?.();
        return Promise.resolve();
      },
      setAccessLevel: vi.fn(async () => undefined),
    } },
  };
  vi.stubGlobal("chrome", chromeMock);
  return { records };
}

async function selectedCheckpoint(records: Record<string, unknown>) {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return (records.workspace as { selectedCheckpointId: string | null }).selectedCheckpointId;
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => vi.unstubAllGlobals());

describe("newestCheckpointIdForTask", () => {
  const list = [
    cp("old", "example.com/task", "2026-01-01T00:00:00.000Z"),
    cp("new", "example.com/task", "2026-02-01T00:00:00.000Z"),
    cp("other", "other.com/x", "2026-03-01T00:00:00.000Z"),
  ];
  it("picks the newest checkpoint for the task", async () => {
    setup();
    const bg = await loadBackground();
    expect(bg.newestCheckpointIdForTask(list, "example.com/task")).toBe("new");
  });
  it("returns null when nothing matches", async () => {
    setup();
    const bg = await loadBackground();
    expect(bg.newestCheckpointIdForTask(list, "missing.com/")).toBe(null);
    expect(bg.newestCheckpointIdForTask([], "example.com/task")).toBe(null);
  });
});

describe("tab following", () => {
  it("selects the newest checkpoint for the activated tab", async () => {
    const { records } = setup();
    tabUrls = { 7: "https://example.com/task?attempt=2" };
    await loadBackground();
    activated!({ tabId: 7, windowId: 1 });
    expect(await selectedCheckpoint(records)).toBe("new");
  });

  it("keeps the selection when the tab has no checkpoint", async () => {
    const { records } = setup();
    tabUrls = { 9: "https://unrelated.example/page" };
    await loadBackground();
    activated!({ tabId: 9, windowId: 1 });
    expect(await selectedCheckpoint(records)).toBe("old");
  });

  it("ignores unreadable tab URLs", async () => {
    const { records } = setup();
    tabUrls = {};
    await loadBackground();
    activated!({ tabId: 11, windowId: 1 });
    expect(await selectedCheckpoint(records)).toBe("old");
  });

  it("clears a failed capture banner when switching tabs", async () => {
    const { records } = setup();
    records["meta:lastCapture"] = { ok: false, at: "2026-01-01T00:00:00.000Z", checkpointId: null, code: "SCRIPT_DENIED", message: "denied" };
    tabUrls = { 9: "https://unrelated.example/page" };
    await loadBackground();
    activated!({ tabId: 9, windowId: 1 });
    expect(await selectedCheckpoint(records)).toBe("old");
    expect(records["meta:lastCapture"]).toBeUndefined();
  });

  it("keeps a successful capture record when switching tabs", async () => {
    const { records } = setup();
    records["meta:lastCapture"] = { ok: true, at: "2026-01-01T00:00:00.000Z", checkpointId: "new", code: null, message: null };
    tabUrls = { 7: "https://example.com/task" };
    await loadBackground();
    activated!({ tabId: 7, windowId: 1 });
    expect(await selectedCheckpoint(records)).toBe("new");
    expect(records["meta:lastCapture"]).toBeDefined();
  });

  it("follows same-tab navigations on completion", async () => {
    const { records } = setup();
    tabUrls = { 7: "https://example.com/task" };
    await loadBackground();
    updated!(7, { status: "complete" });
    expect(await selectedCheckpoint(records)).toBe("new");
  });

  it("ignores completion of a background tab", async () => {
    const { records } = setup();
    tabUrls = { 7: "https://example.com/task", 9: "https://example.com/task" };
    await loadBackground();
    updated!(9, { status: "complete" });
    expect(await selectedCheckpoint(records)).toBe("old");
  });
});
