// Storage schema versioning + startup reconciliation.
// Multi-key writes are not transactional: on worker startup, drop invalid
// workspace references and surface orphan records instead of assuming
// consistency. Pending jobs older than 60s become interrupted/retryable.

import type { AsyncStorageArea } from "./repository";
import { defaultSummaryJob, defaultWorkspace } from "./repository";
import type { ActivityEvent, Checkpoint, Note, SummaryJob } from "../shared/contracts";

export const SCHEMA_VERSION = 1 as const;
export const STALE_PENDING_MS = 60_000;

export async function ensureDefaults(area: AsyncStorageArea): Promise<void> {
  const got = await area.get(["meta", "workspace"]);
  const writes: Record<string, unknown> = {};
  if (!got["meta"]) writes["meta"] = { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString() };
  if (!got["workspace"]) writes["workspace"] = defaultWorkspace();
  if (Object.keys(writes).length > 0) await area.set(writes);
}

export interface ReconcileReport {
  removedWorkspaceRefs: string[];
  orphanNoteIds: string[];
  orphanCheckpointIds: string[];
  interruptedJobs: string[];
  prunedEventIds: string[];
}

export async function reconcileOnStartup(area: AsyncStorageArea): Promise<ReconcileReport> {
  await ensureDefaults(area);
  const all = await area.get(null);
  const report: ReconcileReport = {
    removedWorkspaceRefs: [],
    orphanNoteIds: [],
    orphanCheckpointIds: [],
    interruptedJobs: [],
    prunedEventIds: [],
  };
  const checkpoints = new Set<string>();
  const notes = new Set<string>();
  for (const key of Object.keys(all)) {
    if (key.startsWith("checkpoint:")) checkpoints.add(key.slice("checkpoint:".length));
    else if (key.startsWith("note:")) notes.add(key.slice("note:".length));
  }
  const ws = { ...defaultWorkspace(), ...((all["workspace"] as Record<string, unknown>) ?? {}) } as {
    openNoteIds: string[];
    activeNoteId: string | null;
    selectedCheckpointId: string | null;
  };
  const openNoteIds = ws.openNoteIds.filter((id) => {
    if (!notes.has(id)) {
      report.removedWorkspaceRefs.push(`openNote:${id}`);
      return false;
    }
    return true;
  });
  let activeNoteId = ws.activeNoteId;
  if (activeNoteId && !notes.has(activeNoteId)) {
    report.removedWorkspaceRefs.push(`activeNote:${activeNoteId}`);
    activeNoteId = openNoteIds[openNoteIds.length - 1] ?? null;
  }
  let selectedCheckpointId = ws.selectedCheckpointId;
  if (selectedCheckpointId && !checkpoints.has(selectedCheckpointId)) {
    report.removedWorkspaceRefs.push(`selectedCheckpoint:${selectedCheckpointId}`);
    selectedCheckpointId = null;
  }
  await area.set({ workspace: { ...defaultWorkspace(), ...(all["workspace"] as object), openNoteIds, activeNoteId, selectedCheckpointId } });

  // Orphans: valid records not referenced by the workspace (surfaced, kept).
  for (const id of notes) {
    const n = all[`note:${id}`] as Note;
    if (!openNoteIds.includes(id)) report.orphanNoteIds.push(n?.id ?? id);
  }
  void checkpoints;

  // Stale pending jobs -> interrupted/retryable, preserving last result.
  const now = Date.now();
  const staleWrites: Record<string, unknown> = {};
  for (const key of Object.keys(all)) {
    if (!key.startsWith("summary:")) continue;
    const job = all[key] as SummaryJob;
    if (job?.status === "pending") {
      const age = job.startedAt ? now - Date.parse(job.startedAt) : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(age) || age > STALE_PENDING_MS) {
        const checkpointId = key.slice("summary:".length);
        staleWrites[key] = {
          ...(job ?? defaultSummaryJob(checkpointId)),
          status: "failed",
          error: { code: "INTERRUPTED", message: "Panel closed or worker restarted before completion. Retry to regenerate." },
        };
        report.interruptedJobs.push(checkpointId);
      }
    }
  }
  if (Object.keys(staleWrites).length > 0) await area.set(staleWrites);

  // Orphan checkpoints: checkpoint records whose summary job is missing get one.
  const missingJobs: Record<string, unknown> = {};
  for (const key of Object.keys(all)) {
    if (!key.startsWith("checkpoint:")) continue;
    const id = key.slice("checkpoint:".length);
    if (!all[`summary:${id}`]) {
      missingJobs[`summary:${id}`] = defaultSummaryJob(id);
      report.orphanCheckpointIds.push((all[key] as Checkpoint)?.id ?? id);
    }
  }
  if (Object.keys(missingJobs).length > 0) await area.set(missingJobs);

  // Activity events are append-only: cap them so long-lived profiles do not
  // press against the chrome.storage.local quota.
  const MAX_RETAINED_EVENTS = 200;
  const eventEntries = Object.keys(all)
    .filter((key) => key.startsWith("event:"))
    .map((key) => ({ key, ts: Date.parse((all[key] as ActivityEvent | undefined)?.timestamp ?? "") || 0 }));
  if (eventEntries.length > MAX_RETAINED_EVENTS) {
    eventEntries.sort((a, b) => b.ts - a.ts);
    const drop = eventEntries.slice(MAX_RETAINED_EVENTS).map((e) => e.key);
    await area.remove(drop);
    report.prunedEventIds.push(...drop.map((key) => key.slice("event:".length)));
  }
  return report;
}
