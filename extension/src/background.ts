// Extension service worker: single writer for persistent records,
// capture orchestration, and typed panel commands. No AI HTTP here:
// the panel owns note drafts and executes inference requests while open.

import {
  newId,
  nowIso,
  type Checkpoint,
  type LastCapture,
  type WorkerCommand,
  type WorkerResponse,
} from "./shared/contracts";
import { buildSummaryPayload } from "./shared/payload";
import { cleanUrl, taskKeyForUrl } from "./capture/types";
import { workerCommandSchema } from "./shared/validation";
import { Repository, type AsyncStorageArea } from "./storage/repository";
import { ensureDefaults, reconcileOnStartup } from "./storage/migrations";
import { buildGenericOutcome, extractGenericInPage } from "./capture/generic";
import { buildLeetCodeOutcome, extractLeetCodeProblemInPage, isLeetCodeProblemUrl } from "./capture/leetcode";

const chromeArea: AsyncStorageArea = {
  get: (keys) =>
    new Promise((resolve, reject) => {
      try {
        if (keys === null) chrome.storage.local.get(null, (all) => resolve((all ?? {}) as Record<string, unknown>));
        else chrome.storage.local.get(keys, (got) => resolve((got ?? {}) as Record<string, unknown>));
      } catch (e) {
        reject(e);
      }
    }),
  set: (items) =>
    new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    }),
  remove: (keys) =>
    new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    }),
};

const repo = new Repository(chromeArea);
let ready: Promise<unknown> = Promise.resolve();

function ok(data: unknown): WorkerResponse {
  return { ok: true, data };
}
function fail(code: string, message: string): WorkerResponse {
  return { ok: false, error: { code, message } };
}

const UNSUPPORTED_SCHEMES = ["chrome:", "edge:", "about:", "file:", "chrome-extension:", "moz-extension:"];

function unsupportedReason(url: string): string | null {
  try {
    const scheme = new URL(url).protocol;
    if (UNSUPPORTED_SCHEMES.some((s) => scheme.startsWith(s.slice(0, -1)))) {
      return `Capture is unavailable on this page (${scheme}). Existing work is untouched.`;
    }
    return null;
  } catch {
    return "Capture is unavailable: the page URL could not be read.";
  }
}

function isTrustedSender(sender: chrome.runtime.MessageSender): boolean {
  // Accept mutation commands only from trusted extension pages (panel,
  // worker); never from page content scripts (no `tab`-only senders
  // without an extension-frame URL).
  const url = sender.url ?? "";
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  if (url.startsWith("chrome-extension://")) return true;
  // Worker-internal messages have no url/tab.
  if (!sender.tab && !url) return true;
  return false;
}



async function captureTab(tabId: number, tabUrl: string): Promise<WorkerResponse> {
  // The action callback can omit tab.url even when activeTab allows capture.
  // Ask Chrome again before injecting, then use the page's own URL if Chrome
  // still withholds it. A missing callback URL alone is not a capture failure.
  let initialUrl = tabUrl;
  if (!initialUrl) {
    try {
      initialUrl = (await chrome.tabs.get(tabId)).url ?? "";
    } catch {
      // The in-page extractor can still provide location.href.
    }
  }
  if (initialUrl) {
    const blocked = unsupportedReason(initialUrl);
    if (blocked) return fail("UNSUPPORTED_PAGE", blocked);
  }

  // Generic extraction in the top frame.
  interface GenericResult { title: string; url: string; selectedText: string; pageText: string }
  let generic: GenericResult | null = null;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: extractGenericInPage,
    });
    generic = (res?.result as GenericResult | null | undefined) ?? null;
  } catch {
    return fail("SCRIPT_DENIED", "The page denied access for capture. Existing saved work is untouched.");
  }
  if (!generic) return fail("EXTRACTION_EMPTY", "Nothing could be read from this page. Existing saved work is untouched.");

  const capturedUrl = generic.url || initialUrl;
  const blocked = unsupportedReason(capturedUrl);
  if (blocked) return fail("UNSUPPORTED_PAGE", blocked);

  const leetcode = isLeetCodeProblemUrl(capturedUrl);
  let outcome = buildGenericOutcome({
    title: generic.title || "Untitled",
    url: capturedUrl,
    selectedText: generic.selectedText || "",
    pageText: generic.pageText || "",
    code: null,
    language: null,
    missingFields: [],
    truncatedFields: [],
    warnings: [],
  });

  if (leetcode) {
    try {
      const [problemRes] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: extractLeetCodeProblemInPage,
      });
      const problemOut = problemRes?.result as {
        problemText: string | null;
        code: string | null;
        language: string | null;
        partial: boolean;
      } | null;
      outcome = buildLeetCodeOutcome({
        title: generic.title || "Untitled",
        url: capturedUrl,
        selectedText: generic.selectedText || "",
        pageText: generic.pageText || "",
        pageTextFromProblem: problemOut?.problemText ?? null,
        code: problemOut?.code ?? null,
        language: problemOut?.language ?? null,
        codePartial: problemOut ? problemOut.partial : true,
        missingFields: [],
        truncatedFields: [],
        warnings: [],
      });
    } catch {
      // Fall back to the generic snapshot; never fail the whole capture.
      outcome = {
        ...outcome,
        quality: {
          ...outcome.quality,
          code: "partial",
          warnings: [...outcome.quality.warnings, "LeetCode editor read was denied; saved page text only."],
        },
      };
    }
  }

  // Navigation-race guard: discard mixed snapshots.
  let liveUrl = capturedUrl;
  try {
    const tab = await chrome.tabs.get(tabId);
    liveUrl = tab.url || capturedUrl;
  } catch {
    liveUrl = capturedUrl;
  }
  const norm = (u: string) => {
    try {
      const p = new URL(u);
      return `${p.hostname}${p.pathname}`;
    } catch {
      return u;
    }
  };
  if (norm(liveUrl) !== norm(capturedUrl) || (initialUrl && norm(capturedUrl) !== norm(initialUrl))) {
    return fail("NAVIGATION_RACE", "The tab navigated during capture. The mixed snapshot was discarded; capture again.");
  }

  const url = cleanUrl(capturedUrl);
  const cp: Checkpoint = {
    id: newId(),
    schemaVersion: 1,
    createdAt: nowIso(),
    taskKey: taskKeyForUrl(url),
    title: (generic.title || "Untitled").slice(0, 500) || "Untitled",
    url,
    adapter: leetcode ? "leetcode" : "generic",
    pageText: outcome.pageText,
    selectedText: outcome.selectedText,
    code: outcome.code,
    language: outcome.language,
    quality: outcome.quality,
  };
  try {
    await repo.createCheckpoint(cp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "write failed";
    if (/quota/i.test(msg)) return fail("STORAGE_QUOTA", "Storage is full. Delete old checkpoints or export JSON to free space.");
    return fail("STORAGE_ERROR", `Local save failed (${msg}). Nothing was written.`);
  }
  const ws = await repo.updateWorkspace({ selectedCheckpointId: cp.id });
  void ws;
  return ok({ checkpoint: cp });
}

async function handleCommand(cmd: WorkerCommand): Promise<WorkerResponse> {
  switch (cmd.type) {
    case "NOTE_CREATE": {
      const note = await repo.createNote(cmd.title, cmd.linkedCheckpointId ?? null, cmd.body ?? "", cmd.kind);
      return ok({ note });
    }
    case "NOTE_UPDATE": {
      const r = await repo.updateNote(cmd.id, cmd.baseRevision, cmd.title, cmd.body);
      if (r.ok) return ok({ note: r.note });
      if (r.code === "REVISION_CONFLICT")
        return { ok: false, error: { code: "REVISION_CONFLICT", message: "Another panel saved a newer revision. Resolve the conflict; your draft is preserved." } };
      return fail("NOT_FOUND", "Note no longer exists.");
    }
    case "NOTE_CLOSE": {
      const ws = await repo.closeNote(cmd.id);
      return ok({ workspace: ws });
    }
    case "NOTE_DELETE": {
      const deleted = await repo.deleteNote(cmd.id);
      return deleted ? ok({ deleted: true }) : fail("NOT_FOUND", "Note no longer exists.");
    }
    case "WORKSPACE_UPDATE": {
      const ws = await repo.updateWorkspace(cmd.fields);
      return ok({ workspace: ws });
    }
    case "SUMMARY_BEGIN": {
      try {
        const workspace = await repo.getWorkspace();
        if (!workspace.aiEnabled) return fail("AI_DISABLED", "Enable AI in Resume before generating a recap.");
        // The payload is built from the exact persisted snapshots returned
        // here. Live notes are never reread, so edits after this point
        // cannot change the request, and the request ID always matches
        // the job that owns these inputs.
        const { job, checkpoint, notes } = await repo.beginSummary(cmd.checkpointId, cmd.noteIds);
        const built = buildSummaryPayload(checkpoint, job.requestId as string, notes);
        if (built.warnings.length > 0) {
          await repo.setSummaryWarnings(cmd.checkpointId, job.requestId as string, built.warnings);
          job.warnings = built.warnings;
        }
        return ok({ job, payload: built.payload });
      } catch {
        return fail("CHECKPOINT_NOT_FOUND", "Checkpoint no longer exists.");
      }
    }
    case "SUMMARY_COMPLETE": {
      const committed = await repo.completeSummary(cmd.checkpointId, cmd.requestId, cmd.result);
      if (!committed) return fail("STALE_RESULT", "A newer summary request superseded this result; it was not committed.");
      return ok({ committed: true });
    }
    case "SUMMARY_FAIL": {
      const recorded = await repo.failSummary(cmd.checkpointId, cmd.requestId, cmd.error);
      return ok({ recorded });
    }
    case "CHECKPOINT_DELETE": {
      const r = await repo.deleteCheckpoint(cmd.id);
      return r.deleted ? ok({ deleted: true }) : fail("NOT_FOUND", "Checkpoint no longer exists.");
    }
  }
}

// ---- lifecycle ----

async function init(): Promise<void> {
  try {
    // Restrict storage access to trusted extension contexts.
    const api = chrome.storage.local as unknown as {
      setAccessLevel?: (opts: { accessLevel: string }) => Promise<void> | void;
    };
    if (typeof api.setAccessLevel === "function") {
      await api.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    }
  } catch {
    // Older Chrome: continue without access-level restriction.
  }
  await ensureDefaults(chromeArea);
  await reconcileOnStartup(chromeArea).catch(() => undefined);
}

// Register listeners synchronously during worker startup.
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isTrustedSender(sender)) {
    sendResponse(fail("UNTRUSTED_SENDER", "Mutation commands are accepted only from extension pages."));
    return false;
  }
  const parsed = workerCommandSchema.safeParse(message);
  if (!parsed.success) {
    sendResponse(fail("INVALID_COMMAND", "Command failed validation."));
    return false;
  }
  ready
    .then(() => handleCommand(parsed.data as WorkerCommand))
    .then(sendResponse)
    .catch((e) => sendResponse(fail("WORKER_ERROR", e instanceof Error ? e.message : "Worker error")));
  return true; // async response
});

// Toolbar click: open the panel immediately in the user-gesture handler,
// then capture using the clicked tab ID.
chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  const tabUrl = tab.url ?? "";
  const open = tab.windowId !== undefined ? chrome.sidePanel.open({ windowId: tab.windowId }) : Promise.resolve();
  void (async () => {
    try {
      await open;
    } catch {
      // Panel open failure must not block capture.
    }
    if (tabId === undefined) return;
    await ready.catch(() => undefined);
    await chrome.storage.local.set({ "meta:capturing": { at: nowIso(), tabId } }).catch(() => undefined);
    const result = await captureTab(tabId, tabUrl);
    await chrome.storage.local.remove(["meta:capturing"]).catch(() => undefined);
    // Persist the outcome so the panel can show failures, not just successes.
    if (result.ok) {
      const data = result.data as { checkpoint?: { id?: string } };
      await chrome.storage.local
        .set({
          "meta:lastCapture": {
            ok: true,
            at: nowIso(),
            checkpointId: data?.checkpoint?.id ?? null,
            code: null,
            message: null,
          } satisfies LastCapture,
        })
        .catch(() => undefined);
    } else {
      await chrome.storage.local
        .set({
          "meta:lastCapture": {
            ok: false,
            at: nowIso(),
            checkpointId: null,
            code: result.error?.code ?? "CAPTURE_FAILED",
            message: result.error?.message ?? "Capture failed.",
          } satisfies LastCapture,
        })
        .catch(() => undefined);
    }
  })();
});

ready = init();
