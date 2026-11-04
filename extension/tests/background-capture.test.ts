import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ClickedTab = { id: number; url?: string; windowId: number };

type PanelMessage = { type: string; stuckPoint?: string };

function setup(tabUrl: string | undefined, liveUrls: (string | undefined)[] = []) {
  const records: Record<string, unknown> = {};
  let onClicked: ((tab: ClickedTab) => void) | undefined;
  let onMessage: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void) | undefined;
  let queryTabs: { id: number; url?: string; windowId: number }[] = [{ id: 7, windowId: 1 }];
  const executeScript = vi.fn(async (): Promise<{ result: unknown }[]> => [{ result: {
    title: "Example task",
    url: "https://example.com/task",
    selectedText: "",
    pageText: "A useful page",
  } }]);
  let getCalls = 0;
  const chromeMock = {
    runtime: { id: "test-extension", lastError: undefined, onMessage: { addListener: (fn: NonNullable<typeof onMessage>) => { onMessage = fn; } } },
    action: { onClicked: { addListener: (fn: (tab: ClickedTab) => void) => { onClicked = fn; } } },
    sidePanel: { open: vi.fn(async () => undefined) },
    scripting: { executeScript },
    tabs: {
      get: vi.fn(async () => ({ url: liveUrls[getCalls++] })),
      query: vi.fn(async () => queryTabs),
      onActivated: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
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
  return {
    records,
    executeScript,
    sidePanelOpen: chromeMock.sidePanel.open,
    setQueryTabs: (tabs: { id: number; url?: string; windowId: number }[]) => { queryTabs = tabs; },
    click: () => {
      if (!onClicked) throw new Error("Action listener was not registered");
      onClicked({ id: 1, url: tabUrl, windowId: 1 });
    },
    send: (message: PanelMessage) =>
      new Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }>((resolve) => {
        if (!onMessage) throw new Error("Message listener was not registered");
        onMessage(message, {}, ((response: unknown) => resolve(response as { ok: boolean })) as (response: unknown) => void);
      }),
  };
}

type CaptureFailure = { ok: boolean; error: { code: string; message: string } };

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("toolbar click behavior", () => {
  it("opens the panel without capturing a checkpoint", async () => {
    const { records, executeScript, sidePanelOpen, click } = setup("https://example.com/task");
    await import("../src/background");
    click();
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 1 });
    expect(executeScript).not.toHaveBeenCalled();
    expect(Object.keys(records).filter((k) => k.startsWith("checkpoint:"))).toEqual([]);
    expect(records["meta:lastCapture"]).toBeUndefined();
  });
});

describe("capture edge cases", () => {
  it("captures when tabs.get omits the URL", async () => {
    const { records, executeScript, send } = setup(undefined);
    await import("../src/background");
    const response = await send({ type: "CAPTURE" });
    expect(response.ok).toBe(true);
    expect(executeScript).toHaveBeenCalledOnce();
    const stored = records["meta:lastCapture"] as { ok: boolean; checkpointId: string };
    const checkpoint = records[`checkpoint:${stored.checkpointId}`] as { url: string };
    expect(checkpoint.url).toBe("https://example.com/task");
  });

  it("still blocks a restricted browser URL before injection", async () => {
    const { executeScript, send, setQueryTabs } = setup("https://example.com/task");
    setQueryTabs([{ id: 1, url: "chrome://settings", windowId: 1 }]);
    await import("../src/background");
    const response = await send({ type: "CAPTURE" }) as unknown as CaptureFailure;
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("UNSUPPORTED_PAGE");
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("reports the restricted page when injection is denied without a tab URL", async () => {
    const { executeScript, send } = setup(undefined, [undefined, "chrome://settings"]);
    executeScript.mockRejectedValueOnce(new Error("denied"));
    await import("../src/background");
    const response = await send({ type: "CAPTURE" }) as unknown as CaptureFailure;
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("UNSUPPORTED_PAGE");
  });

  it("explains file URLs with the access toggle when injection is denied", async () => {
    const { executeScript, send } = setup(undefined, [undefined, "file:///C:/notes.txt"]);
    executeScript.mockRejectedValueOnce(new Error("denied"));
    await import("../src/background");
    const response = await send({ type: "CAPTURE" }) as unknown as CaptureFailure;
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("UNSUPPORTED_PAGE");
    expect(response.error.message).toContain("Allow access to file URLs");
  });

  it("explains the toolbar-click grant when a normal page denies injection", async () => {
    const { executeScript, send } = setup("https://example.com/sheet", ["https://example.com/sheet"]);
    executeScript.mockRejectedValueOnce(new Error("denied"));
    await import("../src/background");
    const response = await send({ type: "CAPTURE" }) as unknown as CaptureFailure;
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("TAB_ACCESS_DENIED");
  });

  it("discards a capture when the tab navigates after extraction", async () => {
    const { send } = setup(undefined, [undefined, "https://example.com/other"]);
    await import("../src/background");
    const response = await send({ type: "CAPTURE" }) as unknown as CaptureFailure;
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("NAVIGATION_RACE");
  });

  it("keeps unavailable quality when the LeetCode read is denied on an empty page", async () => {
    const leet = "https://leetcode.com/problems/two-sum/";
    const { records, executeScript, send } = setup(leet, [leet]);
    executeScript
      .mockImplementationOnce(async () => [{ result: { title: "", url: leet, selectedText: "", pageText: "" } }])
      .mockRejectedValueOnce(new Error("denied"));
    await import("../src/background");
    const response = await send({ type: "CAPTURE" });
    expect(response.ok).toBe(true);
    const stored = records["meta:lastCapture"] as { ok: boolean; checkpointId: string };
    const cp = records[`checkpoint:${stored.checkpointId}`] as { quality: { code: string } };
    expect(cp.quality.code).toBe("unavailable");
  });

  it("discards a capture when the tab navigates between extraction passes", async () => {
    const a = "https://leetcode.com/problems/two-sum/";
    const b = "https://leetcode.com/problems/other/";
    const { executeScript, send } = setup(a, [a]);
    executeScript
      .mockImplementationOnce(async () => [{ result: { title: "Two Sum", url: a, selectedText: "", pageText: "desc" } }])
      .mockImplementationOnce(async () => [{ result: { problemText: "desc", code: "x", language: "python", partial: true, url: b } }]);
    await import("../src/background");
    const response = await send({ type: "CAPTURE" }) as unknown as CaptureFailure;
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("NAVIGATION_RACE");
  });

  it("saves other tabs after a restricted-tab failure without a reload", async () => {
    const { records, send } = setup(undefined, ["chrome://extensions/", undefined]);
    await import("../src/background");
    const failed = await send({ type: "CAPTURE" });
    expect(failed.ok).toBe(false);
    expect((failed as unknown as CaptureFailure).error.code).toBe("UNSUPPORTED_PAGE");
    // No stuck flag, failure recorded, and the next tab saves normally.
    expect(records["meta:capturing"]).toBeUndefined();
    expect((records["meta:lastCapture"] as { ok: boolean }).ok).toBe(false);
    const retry = await send({ type: "CAPTURE" });
    expect(retry.ok).toBe(true);
    expect((records["meta:lastCapture"] as { ok: boolean }).ok).toBe(true);
    expect(records["meta:capturing"]).toBeUndefined();
  });

  it("records a failure instead of wedging when a workspace write throws", async () => {
    const { records, send } = setup(undefined);
    await import("../src/background");
    const local = (globalThis as unknown as { chrome: { storage: { local: {
      set: (items: Record<string, unknown>, callback?: () => void) => Promise<unknown>;
    } } } }).chrome.storage.local;
    const realSet = local.set.bind(local);
    local.set = ((items: Record<string, unknown>, callback?: () => void) => {
      if ("workspace" in items) throw new Error("boom");
      return realSet(items, callback);
    }) as typeof local.set;
    const response = await send({ type: "CAPTURE" });
    expect(response.ok).toBe(false);
    expect(records["meta:capturing"]).toBeUndefined();
    expect((records["meta:lastCapture"] as { ok: boolean }).ok).toBe(false);
  });

  it("trims an overlong stuck point and flags it", async () => {
    const { records, send } = setup(undefined);
    await import("../src/background");
    const response = await send({ type: "CAPTURE", stuckPoint: `stuck here ${"x".repeat(600)}` });
    expect(response.ok).toBe(true);
    const stored = records["meta:lastCapture"] as { ok: boolean; checkpointId: string };
    const cp = records[`checkpoint:${stored.checkpointId}`] as {
      stuckPoint: string | null;
      quality: { code: string; warnings: string[] };
    };
    expect(cp.stuckPoint).toHaveLength(500);
    expect(cp.quality.warnings.join(" ")).toContain("trimmed to 500 characters");
  });
});

describe("panel-initiated capture", () => {
  it("captures the active tab without the toolbar", async () => {
    const { records, executeScript, send } = setup(undefined);
    await import("../src/background");
    const response = await send({ type: "CAPTURE" });
    expect(response.ok).toBe(true);
    expect(executeScript).toHaveBeenCalledOnce();
    const stored = records["meta:lastCapture"] as { ok: boolean; checkpointId: string };
    expect(stored.ok).toBe(true);
    const checkpoint = records[`checkpoint:${stored.checkpointId}`] as { url: string };
    expect(checkpoint.url).toBe("https://example.com/task");
  });

  it("reports when there is no active tab", async () => {
    const { executeScript, send, setQueryTabs } = setup(undefined);
    setQueryTabs([]);
    await import("../src/background");
    const response = await send({ type: "CAPTURE" });
    expect(response.ok).toBe(false);
    expect((response as { error: { code: string } }).error.code).toBe("NO_ACTIVE_TAB");
    expect(executeScript).not.toHaveBeenCalled();
  });
});

describe("worker command branches", () => {
  type Ok<T> = { ok: true; data: T };
  type Err = { ok: false; error: { code: string; message: string } };
  const cmd = (message: Record<string, unknown>) => message as unknown as PanelMessage;

  it("creates, updates, closes, and deletes notes", async () => {
    const { records, send } = setup(undefined);
    await import("../src/background");
    const created = await send(cmd({ type: "NOTE_CREATE", title: "n" })) as unknown as Ok<{ note: { id: string; revision: number } }>;
    expect(created.ok).toBe(true);
    const id = created.data.note.id;
    const updated = await send(cmd({ type: "NOTE_UPDATE", id, baseRevision: 0, title: "n2", body: "b" })) as unknown as Ok<{ note: { revision: number } }>;
    expect(updated.ok).toBe(true);
    expect(updated.data.note.revision).toBe(1);
    const conflict = await send(cmd({ type: "NOTE_UPDATE", id, baseRevision: 0, title: "stale", body: "b" })) as unknown as Err;
    expect(conflict.ok).toBe(false);
    expect(conflict.error.code).toBe("REVISION_CONFLICT");
    const missing = await send(cmd({ type: "NOTE_UPDATE", id: "ghost", baseRevision: 0, title: "x", body: "y" })) as unknown as Err;
    expect(missing.error.code).toBe("NOT_FOUND");
    const closed = await send(cmd({ type: "NOTE_CLOSE", id })) as unknown as Ok<{ workspace: { openNoteIds: string[] } }>;
    expect(closed.ok).toBe(true);
    expect(closed.data.workspace.openNoteIds).not.toContain(id);
    const deleted = await send(cmd({ type: "NOTE_DELETE", id })) as unknown as Ok<{ deleted: boolean }>;
    expect(deleted.data.deleted).toBe(true);
    expect(records[`note:${id}`]).toBeUndefined();
    const deletedAgain = await send(cmd({ type: "NOTE_DELETE", id })) as unknown as Err;
    expect(deletedAgain.error.code).toBe("NOT_FOUND");
  });

  it("updates the workspace and guards summaries behind AI", async () => {
    const { records, send } = setup(undefined);
    await import("../src/background");
    const cap = await send({ type: "CAPTURE" });
    expect(cap.ok).toBe(true);
    const id = (records["meta:lastCapture"] as { checkpointId: string }).checkpointId;
    const disabled = await send(cmd({ type: "SUMMARY_BEGIN", checkpointId: id, noteIds: [] })) as unknown as Err;
    expect(disabled.error.code).toBe("AI_DISABLED");
    const ws = await send(cmd({ type: "WORKSPACE_UPDATE", fields: { aiEnabled: true } })) as unknown as Ok<{ workspace: { aiEnabled: boolean } }>;
    expect(ws.data.workspace.aiEnabled).toBe(true);
    const begun = await send(cmd({ type: "SUMMARY_BEGIN", checkpointId: id, noteIds: [] })) as unknown as Ok<{ job: { requestId: string }; payload: unknown }>;
    expect(begun.ok).toBe(true);
    expect(typeof begun.data.job.requestId).toBe("string");
    const missing = await send(cmd({ type: "SUMMARY_BEGIN", checkpointId: "ghost", noteIds: [] })) as unknown as Err;
    expect(missing.error.code).toBe("CHECKPOINT_NOT_FOUND");
    const result = { recap: "r", observedFacts: [], possibleBlocker: null, nextAction: "n", uncertainties: [] };
    const failed = await send(cmd({ type: "SUMMARY_FAIL", checkpointId: id, requestId: begun.data.job.requestId, error: { code: "E", message: "m" } })) as unknown as Ok<{ recorded: boolean }>;
    expect(failed.data.recorded).toBe(true);
    const done = await send(cmd({ type: "SUMMARY_COMPLETE", checkpointId: id, requestId: begun.data.job.requestId, result })) as unknown as Ok<{ committed: boolean }>;
    expect(done.data.committed).toBe(true);
    const stale = await send(cmd({ type: "SUMMARY_COMPLETE", checkpointId: id, requestId: "other", result })) as unknown as Err;
    expect(stale.error.code).toBe("STALE_RESULT");
    const deleted = await send(cmd({ type: "CHECKPOINT_DELETE", id })) as unknown as Ok<{ deleted: boolean }>;
    expect(deleted.data.deleted).toBe(true);
    const gone = await send(cmd({ type: "CHECKPOINT_DELETE", id })) as unknown as Err;
    expect(gone.error.code).toBe("NOT_FOUND");
    const resumed = await send(cmd({ type: "CHECKPOINT_RESUMED", id })) as unknown as Err;
    expect(resumed.error.code).toBe("NOT_FOUND");
    const invalid = await send(cmd({ type: "BOGUS" })) as unknown as Err;
    expect(invalid.error.code).toBe("INVALID_COMMAND");
  });
});
