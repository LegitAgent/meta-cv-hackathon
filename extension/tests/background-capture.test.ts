import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ClickedTab = { id: number; url?: string; windowId: number };

function setup(tabUrl: string | undefined, liveUrls: (string | undefined)[] = []) {
  const records: Record<string, unknown> = {};
  let onClicked: ((tab: ClickedTab) => void) | undefined;
  const executeScript = vi.fn(async () => [{ result: {
    title: "Example task",
    url: "https://example.com/task",
    selectedText: "",
    pageText: "A useful page",
  } }]);
  let getCalls = 0;
  const chromeMock = {
    runtime: { id: "test-extension", lastError: undefined, onMessage: { addListener: vi.fn() } },
    action: { onClicked: { addListener: (fn: (tab: ClickedTab) => void) => { onClicked = fn; } } },
    sidePanel: { open: vi.fn(async () => undefined) },
    scripting: { executeScript },
    tabs: { get: vi.fn(async () => ({ url: liveUrls[getCalls++] })) },
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
    click: () => {
      if (!onClicked) throw new Error("Action listener was not registered");
      onClicked({ id: 1, url: tabUrl, windowId: 1 });
    },
  };
}

async function captureResult(records: Record<string, unknown>) {
  for (let i = 0; i < 50 && !records["meta:lastCapture"]; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return records["meta:lastCapture"] as { ok: boolean; code: string | null; checkpointId: string | null } | undefined;
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("toolbar capture URL recovery", () => {
  it("captures when the click and tabs.get both omit the URL", async () => {
    const { records, executeScript, click } = setup(undefined);
    await import("../src/background");
    click();
    const result = await captureResult(records);
    expect(result?.ok).toBe(true);
    expect(executeScript).toHaveBeenCalledOnce();
    const checkpoint = records[`checkpoint:${result?.checkpointId}`] as { url: string };
    expect(checkpoint.url).toBe("https://example.com/task");
  });

  it("still blocks a restricted browser URL before injection", async () => {
    const { records, executeScript, click } = setup("chrome://settings");
    await import("../src/background");
    click();
    const result = await captureResult(records);
    expect(result?.ok).toBe(false);
    expect(result?.code).toBe("UNSUPPORTED_PAGE");
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("discards a capture when the tab navigates after extraction", async () => {
    const { records, click } = setup(undefined, [undefined, "https://example.com/other"]);
    await import("../src/background");
    click();
    const result = await captureResult(records);
    expect(result?.ok).toBe(false);
    expect(result?.code).toBe("NAVIGATION_RACE");
  });
});
