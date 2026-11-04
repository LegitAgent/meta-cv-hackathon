// Extension service worker: single writer for persistent records,
// capture orchestration, and typed panel commands. No AI HTTP here:
// the panel owns note drafts and executes inference requests while open.

import {
  LIMITS,
  newId,
  nowIso,
  type Checkpoint,
  type LastCapture,
  type WorkerCommand,
  type WorkerResponse,
  type Workspace,
} from "./shared/contracts";
import { buildSummaryPayload } from "./shared/payload";
import { cleanUrl, taskKeyForUrl } from "./capture/types";
import { workerCommandSchema } from "./shared/validation";
import { Repository, type AsyncStorageArea } from "./storage/repository";
import { ensureDefaults, reconcileOnStartup } from "./storage/migrations";
import { buildGenericOutcome, extractGenericInPage } from "./capture/generic";
import { buildLeetCodeOutcome, extractLeetCodeProblemInPage, isLeetCodeProblemUrl } from "./capture/leetcode";
import { captureScreenshot } from "./capture/screenshot";

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



async function captureTab(tabId: number, tabUrl: string, stuckPoint: string | null = null): Promise<WorkerResponse> {
  // One optional line about where the user is stuck; trimming flags a
  // warning but an empty value never blocks the save.
  let stuck = (stuckPoint ?? "").trim() || null;
  const captureWarnings: string[] = [];
  if (stuck && stuck.length > LIMITS.STUCK_POINT_MAX) {
    stuck = stuck.slice(0, LIMITS.STUCK_POINT_MAX);
    captureWarnings.push(`Stuck point was trimmed to ${LIMITS.STUCK_POINT_MAX} characters.`);
  }
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
    // The click URL can be withheld, skipping the scheme check above: read the
    // live tab URL to tell restricted pages apart from real denials.
    try {
      const liveUrl = (await chrome.tabs.get(tabId)).url ?? "";
      const blocked = liveUrl ? unsupportedReason(liveUrl) : null;
      if (blocked) {
        if (liveUrl.startsWith("file:")) return fail("UNSUPPORTED_PAGE", `${blocked} Enable "Allow access to file URLs" on Backtrack's card in chrome://extensions to capture local files.`);
        return fail("UNSUPPORTED_PAGE", blocked);
      }
    } catch {
      // Fall through to the generic denial below.
    }
    // Reachable when the page itself refused injection: Chrome only grants
    // access to the tab where the toolbar button was clicked, so saving from
    // the panel on a different tab is denied here.
    return fail("TAB_ACCESS_DENIED", "Backtrack can only read the tab where its toolbar button was clicked. Click the toolbar button while viewing this page, then press Save this page. Existing saved work is untouched.");
  }
  if (!generic) return fail("EXTRACTION_EMPTY", "Nothing could be read from this page. Existing saved work is untouched.");

  const capturedUrl = generic.url || initialUrl;
  const blocked = unsupportedReason(capturedUrl);
  if (blocked) return fail("UNSUPPORTED_PAGE", blocked);

  const norm = (u: string) => {
    try {
      const p = new URL(u);
      return `${p.hostname}${p.pathname}`;
    } catch {
      return u;
    }
  };
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
    warnings: [...captureWarnings],
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
        url: string;
      } | null;
      // The two extraction passes run back to back; discard the pair when the
      // tab navigated between them instead of mixing snapshots.
      if (problemOut && norm(problemOut.url || "") !== norm(capturedUrl) && problemOut.url) {
        return fail("NAVIGATION_RACE", "The tab navigated during capture. The mixed snapshot was discarded; capture again.");
      }
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
        warnings: [...captureWarnings],
      });
    } catch {
      // Fall back to the generic snapshot; never fail the whole capture.
      // Keep "unavailable" when nothing was captured at all.
      outcome = {
        ...outcome,
        quality: {
          ...outcome.quality,
          code: outcome.quality.code === "unavailable" ? "unavailable" : "partial",
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
  if (norm(liveUrl) !== norm(capturedUrl) || (initialUrl && norm(capturedUrl) !== norm(initialUrl))) {
    return fail("NAVIGATION_RACE", "The tab navigated during capture. The mixed snapshot was discarded; capture again.");
  }

  // Optional visual supplement: a compressed screenshot of the visible tab.
  // Text extraction above stays the source of truth; a missing screenshot
  // never fails the capture.
  const screenshot = await captureScreenshot(tabId);
  if (!screenshot) {
    outcome = {
      ...outcome,
      quality: {
        ...outcome.quality,
        warnings: [...outcome.quality.warnings, "Screenshot unavailable; this recap uses text only."],
      },
    };
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
    screenshot,
    stuckPoint: stuck,
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

/** Newest checkpoint id for a task, or null when nothing matches. */
export function newestCheckpointIdForTask(checkpoints: Checkpoint[], taskKey: string): string | null {
  let best: Checkpoint | null = null;
  for (const c of checkpoints) {
    if (c.taskKey !== taskKey) continue;
    if (!best || c.createdAt > best.createdAt) best = c;
  }
  return best?.id ?? null;
}

/** Follow browser tab switches: select the newest checkpoint for the active
 * tab's task, or clear the selection so an unsaved tab shows a fresh save
 * prompt. A navigation or tab switch starts a new context: never drag a
 * stale capture error along. */
async function clearFailureBanner(): Promise<void> {
  try {
    const last = (await chromeArea.get(["meta:lastCapture"]))["meta:lastCapture"] as LastCapture | undefined;
    if (last && !last.ok) await chromeArea.remove(["meta:lastCapture"]);
  } catch {
    // Read-only failure: leave the banner alone.
  }
}

async function syncSelectionToTab(tabId: number): Promise<void> {
  await clearFailureBanner();
  let url = "";
  try {
    url = (await chrome.tabs.get(tabId)).url ?? "";
  } catch {
    return;
  }
  if (!url) return;
  const taskKey = taskKeyForUrl(cleanUrl(url));
  if (!taskKey) return;
  try {
    const all = await chromeArea.get(null);
    const checkpoints = Object.entries(all)
      .filter(([key]) => key.startsWith("checkpoint:"))
      .map(([, value]) => value as Checkpoint);
    const id = newestCheckpointIdForTask(checkpoints, taskKey);
    const ws = all["workspace"] as Workspace | undefined;
    if (id && ws?.selectedCheckpointId !== id) {
      await repo.updateWorkspace({ selectedCheckpointId: id });
    } else if (!id && ws?.selectedCheckpointId) {
      // The current tab has no checkpoint: clear the selection so the panel
      // shows a fresh save prompt instead of another page's checkpoint.
      await repo.updateWorkspace({ selectedCheckpointId: null });
    }
    // The failure banner is cleared up front by clearFailureBanner, before
    // the early returns above, so no tab state can trap it.
  } catch {
    // Read-only failure: keep the current selection.
  }
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
        const { job, checkpoint, notes, missingNoteIds } = await repo.beginSummary(cmd.checkpointId, cmd.noteIds);
        const built = buildSummaryPayload(checkpoint, job.requestId as string, notes);
        // Deleted or unknown note IDs never reach the payload builder, so they
        // get their own warning here instead of failing silently.
        const warnings = [...missingNoteIds.map((id) => `Note "${id}" was deleted before the recap and was left out.`), ...built.warnings];
        if (warnings.length > 0) {
          await repo.setSummaryWarnings(cmd.checkpointId, job.requestId as string, warnings);
          job.warnings = warnings;
        }
        return ok({ job, payload: built.payload });
      } catch (e) {
        if (e instanceof Error && e.message === "CHECKPOINT_NOT_FOUND")
          return fail("CHECKPOINT_NOT_FOUND", "Checkpoint no longer exists.");
        throw e;
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
    case "CAPTURE": {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!active || active.id === undefined) return fail("NO_ACTIVE_TAB", "No active tab to capture.");
      return runCaptureFlow(active.id, active.url ?? "", typeof cmd.stuckPoint === "string" ? cmd.stuckPoint : null);
    }
    case "CHECKPOINT_DELETE": {
      const r = await repo.deleteCheckpoint(cmd.id);
      return r.deleted ? ok({ deleted: true }) : fail("NOT_FOUND", "Checkpoint no longer exists.");
    }
    case "CHECKPOINT_RESUMED": {
      const recorded = await repo.recordResume(cmd.id);
      return recorded ? ok({ recorded: true }) : fail("NOT_FOUND", "Checkpoint no longer exists.");
    }
    default:
      return fail("INVALID_COMMAND", "Command failed validation.");
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

// Shared capture-and-record flow: save locally first, then persist the
// outcome so the panel can show failures, not just successes.
async function runCaptureFlow(tabId: number, tabUrl: string, stuckPoint: string | null = null): Promise<WorkerResponse> {
  try {
    await ready;
  } catch (e) {
    return fail("WORKER_ERROR", e instanceof Error ? `Storage failed to initialize: ${e.message}` : "Storage failed to initialize.");
  }
  await chrome.storage.local.set({ "meta:capturing": { at: nowIso(), tabId } }).catch(() => undefined);
  // Never let an unexpected throw escape: a stuck "meta:capturing" flag or a
  // missing lastCapture would leave the panel unable to save again without a
  // reload. Convert surprises into a failure outcome like any other.
  let result: WorkerResponse;
  try {
    result = await captureTab(tabId, tabUrl, stuckPoint);
  } catch (e) {
    result = fail(
      "CAPTURE_FAILED",
      e instanceof Error
        ? `Capture failed unexpectedly (${e.message}). Existing saved work is untouched.`
        : "Capture failed unexpectedly. Existing saved work is untouched.",
    );
  }
  await chrome.storage.local.remove(["meta:capturing"]).catch(() => undefined);
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
  return result;
}

// Toolbar click only opens the panel. Checkpoints are created explicitly
// through the in-panel "Save this page" button (CAPTURE command) — opening
// the panel must never write a checkpoint on its own.
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId === undefined) return;
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
});

// Keep the panel on the current tab's work: tab switches and navigations
// re-point the selection at the newest checkpoint for that tab's task.
// The panel refreshes through the existing storage listener.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void syncSelectionToTab(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete" && info.url === undefined) return;
  // Any finished navigation starts a new context: drop a stale failure banner
  // even when the tab cannot be read or is not the active one.
  void clearFailureBanner();
  // A background tab finishing load must not steal the selection: only sync
  // when the updated tab is the active one.
  void (async () => {
    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (active?.id === tabId) void syncSelectionToTab(tabId);
    } catch {
      // Keep the current selection.
    }
  })();
});

ready = init();
