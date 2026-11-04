import type {
  ActivityEvent,
  Checkpoint,
  LastCapture,
  Note,
  SummaryJob,
  Workspace,
} from "../shared/contracts";
import { defaultSummaryJob } from "../storage/repository";

export interface PanelSnapshot {
  workspace: Workspace;
  checkpoints: Checkpoint[];
  notes: Note[];
  summaries: Record<string, SummaryJob>;
  events: ActivityEvent[];
  lastCapture: LastCapture | null;
}

function isLastCapture(value: unknown): value is LastCapture {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ok === "boolean" &&
    typeof v.at === "string" &&
    (v.checkpointId === null || typeof v.checkpointId === "string") &&
    (v.code === null || typeof v.code === "string") &&
    (v.message === null || typeof v.message === "string")
  );
}

/** Build the persisted capture-outcome record from a worker result. */
export function toLastCaptureRecord(
  result: { ok: boolean; data?: unknown; error?: { code: string; message: string } },
  at: string,
): LastCapture {
  if (result.ok) {
    const data = result.data as { checkpoint?: { id?: string } } | undefined;
    return { ok: true, at, checkpointId: data?.checkpoint?.id ?? null, code: null, message: null };
  }
  return {
    ok: false,
    at,
    checkpointId: null,
    code: result.error?.code ?? "CAPTURE_FAILED",
    message: result.error?.message ?? "Capture failed.",
  };
}

/**
 * Merge a completed save into the draft. Newer typing that arrived while the
 * save was in flight is never clobbered: the saved revision is adopted but
 * the pending text is kept so the follow-up save sends it.
 */
export interface PendingEdit {
  title: string;
  body: string;
  baseRevision: number;
}

/**
 * Decide which draft the panel should display when the active note (re)loads.
 * Pending text is bound to its originating note: it is shown only when the
 * incoming note is the note it was typed in, and it adopts the incoming
 * revision so a later save targets the right base. Pending text for any
 * other note never leaks into this display.
 */
export function resolveAdoptedDraft(
  incoming: { id: string; title: string; body: string; revision: number } | null,
  pending: { id: string; title: string; body: string } | null,
): { id: string | null; title: string; body: string; baseRevision: number } {
  if (!incoming) return { id: null, title: "", body: "", baseRevision: 0 };
  if (pending && pending.id === incoming.id) {
    return { id: incoming.id, title: pending.title, body: pending.body, baseRevision: incoming.revision };
  }
  return { id: incoming.id, title: incoming.title, body: incoming.body, baseRevision: incoming.revision };
}

/** Never auto-retry a revision conflict; transient errors may retry. */
export function shouldRetrySave(conflicted: boolean, hasPending: boolean): boolean {
  return !conflicted && hasPending;
}

/** "Saved" is honest only when no unsent text remains. */
export function shouldClaimSaved(outboxSize: number): boolean {
  return outboxSize === 0;
}

export function mergeSavedNote(
  serverNote: Note,
  pending: { title: string; body: string } | null,
): { id: string; title: string; body: string; baseRevision: number } {
  if (!pending) {
    return { id: serverNote.id, title: serverNote.title, body: serverNote.body, baseRevision: serverNote.revision };
  }
  return { id: serverNote.id, title: pending.title, body: pending.body, baseRevision: serverNote.revision };
}

import { BACKEND_URL } from "../shared/config";
export const DEFAULT_BACKEND_URL = BACKEND_URL;

export function snapshotFromStorage(all: Record<string, unknown>): PanelSnapshot {
  const workspace = {
    openNoteIds: [],
    activeNoteId: null,
    selectedCheckpointId: null,
    aiEnabled: false,
    autoSummarize: false,
    ...((all["workspace"] as Record<string, unknown>) ?? {}),
    backendUrl: DEFAULT_BACKEND_URL,
  } as Workspace;
  const checkpoints: Checkpoint[] = [];
  const notes: Note[] = [];
  const summaries: Record<string, SummaryJob> = {};
  const events: ActivityEvent[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith("checkpoint:")) checkpoints.push(value as Checkpoint);
    else if (key.startsWith("note:")) notes.push(value as Note);
    else if (key.startsWith("summary:")) summaries[(value as SummaryJob).checkpointId] = value as SummaryJob;
    else if (key.startsWith("event:")) events.push(value as ActivityEvent);
  }
  checkpoints.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  for (const job of Object.values(summaries)) {
    // Records written before warnings existed.
    if (!Array.isArray(job.warnings)) job.warnings = [];
  }
  if (workspace.selectedCheckpointId && summaries[workspace.selectedCheckpointId] === undefined) {
    summaries[workspace.selectedCheckpointId] = defaultSummaryJob(workspace.selectedCheckpointId);
  }
  const rawLast = all["meta:lastCapture"];
  const lastCapture = isLastCapture(rawLast) ? rawLast : null;
  return { workspace, checkpoints, notes, summaries, events, lastCapture };
}

export function sendCommand<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const r = response as { ok: boolean; data?: T; error?: { code: string; message: string } };
      if (r?.ok) resolve(r.data as T);
      else reject(Object.assign(new Error(r?.error?.message ?? "Worker error"), { code: r?.error?.code }));
    });
  });
}
