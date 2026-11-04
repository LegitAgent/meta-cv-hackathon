// Worker-side single-writer repository over chrome.storage.local.
// All read-modify-write operations are queued (message queue) so rapid
// successive captures and late AI results cannot interleave. Note edits
// use revision conflicts: a stale baseRevision is rejected, never merged.

import {
  newId,
  nowIso,
  type ActivityEvent,
  type ActivityType,
  type Checkpoint,
  type Meta,
  type Note,
  type Summary,
  type SummaryJob,
  type Workspace,
} from "../shared/contracts";
import { BACKEND_URL } from "../shared/config";

export interface AsyncStorageArea {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export const keyCheckpoint = (id: string) => `checkpoint:${id}`;
export const keySummary = (checkpointId: string) => `summary:${checkpointId}`;
export const keyNote = (id: string) => `note:${id}`;
export const keyEvent = (id: string) => `event:${id}`;

export function defaultWorkspace(): Workspace {
  return {
    openNoteIds: [],
    activeNoteId: null,
    selectedCheckpointId: null,
    aiEnabled: false,
    autoSummarize: false,
    backendUrl: BACKEND_URL,
  };
}

export function defaultSummaryJob(checkpointId: string): SummaryJob {
  return {
    checkpointId,
    requestId: null,
    status: "idle",
    startedAt: null,
    includedNoteSnapshots: [],
    result: null,
    error: null,
    warnings: [],
  };
}

export class Repository {
  private tail: Promise<unknown> = Promise.resolve();

  // Reads intentionally bypass the queue; a torn multi-key read is possible
  // and is repaired by reconcileOnStartup rather than by serializing reads.
  constructor(private area: AsyncStorageArea) {}

  /** Serialize mutations; concurrent callers queue behind the tail. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  async read(keys: string[]): Promise<Record<string, unknown>> {
    return this.area.get(keys);
  }

  async readAll(): Promise<Record<string, unknown>> {
    return this.area.get(null);
  }

  // ---- checkpoints (immutable after capture) ----

  createCheckpoint(cp: Checkpoint): Promise<void> {
    return this.enqueue(async () => {
      await this.area.set({ [keyCheckpoint(cp.id)]: cp, [keySummary(cp.id)]: defaultSummaryJob(cp.id) });
      await this.appendEvent("checkpoint.captured", cp.id, cp.adapter).catch(() => undefined);
    });
  }

  async getCheckpoint(id: string): Promise<Checkpoint | null> {
    const got = await this.area.get([keyCheckpoint(id)]);
    return (got[keyCheckpoint(id)] as Checkpoint | undefined) ?? null;
  }

  deleteCheckpoint(id: string): Promise<{ deleted: boolean }> {
    return this.enqueue(async () => {
      const got = await this.area.get([keyCheckpoint(id)]);
      if (!got[keyCheckpoint(id)]) return { deleted: false };
      await this.area.remove([keyCheckpoint(id), keySummary(id)]);
      // Notes are retained: deleting a checkpoint never deletes linked notes.
      const ws = await this.getWorkspace();
      if (ws.selectedCheckpointId === id) {
        // Fall back to the newest remaining checkpoint so an explicit null
        // selection keeps meaning "the current tab has nothing saved".
        const all = await this.area.get(null);
        let newest: Checkpoint | null = null;
        for (const [key, value] of Object.entries(all)) {
          if (!key.startsWith("checkpoint:")) continue;
          const c = value as Checkpoint;
          if (!newest || c.createdAt > newest.createdAt) newest = c;
        }
        await this.area.set({ workspace: { ...ws, selectedCheckpointId: newest?.id ?? null } });
      }
      await this.appendEvent("checkpoint.deleted", id, null).catch(() => undefined);
      return { deleted: true };
    });
  }

  // ---- notes (revision-guarded edits) ----

  createNote(title: string, linkedCheckpointId: string | null = null, body = "", kind?: "codeOverride"): Promise<Note> {
    return this.enqueue(async () => {
      const t = nowIso();
      const note: Note = {
        id: newId(),
        revision: 0,
        title: title.slice(0, 300) || "Untitled note",
        body: body.slice(0, 50000),
        createdAt: t,
        updatedAt: t,
        linkedCheckpointId,
        ...(kind ? { kind } : {}),
      };
      const ws = await this.getWorkspace();
      const openNoteIds = ws.openNoteIds.includes(note.id) ? ws.openNoteIds : [...ws.openNoteIds, note.id];
      await this.area.set({
        [keyNote(note.id)]: note,
        workspace: { ...ws, openNoteIds, activeNoteId: note.id },
      });
      await this.appendEvent("note.created", note.id, null).catch(() => undefined);
      return note;
    });
  }

  async getNote(id: string): Promise<Note | null> {
    const got = await this.area.get([keyNote(id)]);
    return (got[keyNote(id)] as Note | undefined) ?? null;
  }

  updateNote(
    id: string,
    baseRevision: number,
    title: string,
    body: string,
  ): Promise<{ ok: true; note: Note } | { ok: false; code: "REVISION_CONFLICT"; current: Note } | { ok: false; code: "NOT_FOUND"; current: null }> {
    return this.enqueue(async () => {
      const got = await this.area.get([keyNote(id)]);
      const current = got[keyNote(id)] as Note | undefined;
      if (!current) return { ok: false, code: "NOT_FOUND", current: null } as const;
      if (current.revision !== baseRevision) {
        return { ok: false, code: "REVISION_CONFLICT", current } as const;
      }
      const note: Note = {
        ...current,
        title: title.slice(0, 300),
        body: body.slice(0, 50000),
        revision: current.revision + 1,
        updatedAt: nowIso(),
      };
      await this.area.set({ [keyNote(id)]: note });
      return { ok: true, note } as const;
    });
  }

  closeNote(id: string): Promise<Workspace> {
    return this.enqueue(async () => {
      const ws = await this.getWorkspace();
      const openNoteIds = ws.openNoteIds.filter((n) => n !== id);
      const activeNoteId = ws.activeNoteId === id ? (openNoteIds[openNoteIds.length - 1] ?? null) : ws.activeNoteId;
      const next = { ...ws, openNoteIds, activeNoteId };
      await this.area.set({ workspace: next });
      return next;
    });
  }

  deleteNote(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const got = await this.area.get([keyNote(id)]);
      if (!got[keyNote(id)]) return false;
      await this.area.remove([keyNote(id)]);
      const ws = await this.getWorkspace();
      const openNoteIds = ws.openNoteIds.filter((n) => n !== id);
      const activeNoteId = ws.activeNoteId === id ? (openNoteIds[openNoteIds.length - 1] ?? null) : ws.activeNoteId;
      await this.area.set({ workspace: { ...ws, openNoteIds, activeNoteId } });
      await this.appendEvent("note.deleted", id, null).catch(() => undefined);
      return true;
    });
  }

  // ---- workspace ----

  async getWorkspace(): Promise<Workspace> {
    const got = await this.area.get(["workspace"]);
    const ws = got["workspace"] as Partial<Workspace> | undefined;
    return { ...defaultWorkspace(), ...(ws ?? {}), backendUrl: BACKEND_URL };
  }

  updateWorkspace(fields: Partial<Workspace>): Promise<Workspace> {
    return this.enqueue(async () => {
      const ws = await this.getWorkspace();
      const allowed: Partial<Workspace> = {};
      if (fields.openNoteIds !== undefined) allowed.openNoteIds = fields.openNoteIds.slice(0, 100);
      if (fields.activeNoteId !== undefined) allowed.activeNoteId = fields.activeNoteId;
      if (fields.selectedCheckpointId !== undefined) allowed.selectedCheckpointId = fields.selectedCheckpointId;
      if (fields.aiEnabled !== undefined) allowed.aiEnabled = fields.aiEnabled;
      if (fields.autoSummarize !== undefined) allowed.autoSummarize = fields.autoSummarize;
      const next = { ...ws, ...allowed };
      await this.area.set({ workspace: next });
      return next;
    });
  }

  // ---- summary jobs ----

  async getSummaryJob(checkpointId: string): Promise<SummaryJob> {
    const got = await this.area.get([keySummary(checkpointId)]);
    const job = got[keySummary(checkpointId)] as SummaryJob | undefined;
    return job ?? defaultSummaryJob(checkpointId);
  }

  /**
   * Open a summary job and return the exact persisted inputs in one queued
   * operation: the checkpoint plus the note snapshots the request must send.
   * Callers must build the request payload from these values, never by
   * rereading live notes afterwards.
   */
  beginSummary(
    checkpointId: string,
    noteIds: string[],
  ): Promise<{ job: SummaryJob; checkpoint: Checkpoint; notes: { id: string; revision: number; body: string }[]; missingNoteIds: string[] }> {
    return this.enqueue(async () => {
      // Duplicate ids would double-bill the transport budget and send twice.
      const uniqueIds = [...new Set(noteIds)];
      const got = await this.area.get([keyCheckpoint(checkpointId), keySummary(checkpointId), ...uniqueIds.map(keyNote)]);
      const cp = got[keyCheckpoint(checkpointId)] as Checkpoint | undefined;
      if (!cp) throw new Error("CHECKPOINT_NOT_FOUND");
      const prev = (got[keySummary(checkpointId)] as SummaryJob | undefined) ?? defaultSummaryJob(checkpointId);
      const snapshots = uniqueIds.flatMap((id) => {
        const n = got[keyNote(id)] as Note | undefined;
        return n ? [{
          id: n.id,
          revision: n.revision,
          body: n.body,
          linkedCheckpointId: n.linkedCheckpointId,
          ...(n.kind ? { kind: n.kind } : {}),
        }] : [];
      });
      const job: SummaryJob = {
        checkpointId,
        requestId: newId(),
        status: "pending",
        startedAt: nowIso(),
        includedNoteSnapshots: snapshots,
        result: prev.result,
        error: null,
        warnings: [],
      };
      await this.area.set({ [keySummary(checkpointId)]: job });
      const found = new Set(snapshots.map((s) => s.id));
      const missingNoteIds = uniqueIds.filter((id) => !found.has(id));
      return { job, checkpoint: cp, notes: snapshots, missingNoteIds };
    });
  }

  /** Attach transport warnings (e.g. note trimming) to the active job only. */
  setSummaryWarnings(checkpointId: string, requestId: string, warnings: string[]): Promise<boolean> {
    return this.enqueue(async () => {
      const job = await this.getSummaryJob(checkpointId);
      if (job.requestId !== requestId) return false;
      await this.area.set({ [keySummary(checkpointId)]: { ...job, warnings } });
      return true;
    });
  }

  /** Commit only if the active job still carries this requestId. */
  completeSummary(checkpointId: string, requestId: string, result: Summary): Promise<boolean> {
    return this.enqueue(async () => {
      const job = await this.getSummaryJob(checkpointId);
      if (job.requestId !== requestId) return false;
      const got = await this.area.get([keyCheckpoint(checkpointId)]);
      if (!got[keyCheckpoint(checkpointId)]) return false;
      await this.area.set({
        [keySummary(checkpointId)]: { ...job, status: "complete", result, error: null },
      });
      await this.appendEvent("summary.completed", checkpointId, null).catch(() => undefined);
      return true;
    });
  }

  failSummary(checkpointId: string, requestId: string, error: { code: string; message: string; retryAfterSeconds?: number }): Promise<boolean> {
    return this.enqueue(async () => {
      const job = await this.getSummaryJob(checkpointId);
      if (job.requestId !== requestId) return false;
      await this.area.set({
        [keySummary(checkpointId)]: { ...job, status: "failed", error },
      });
      await this.appendEvent("summary.failed", checkpointId, error.code).catch(() => undefined);
      return true;
    });
  }

  /** Record a resume: one append-only event, no checkpoint mutation. */
  recordResume(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const got = await this.area.get([keyCheckpoint(id)]);
      if (!got[keyCheckpoint(id)]) return false;
      await this.appendEvent("checkpoint.resumed", id, null).catch(() => undefined);
      return true;
    });
  }

  // ---- meta + events ----

  async getMeta(): Promise<Meta | null> {
    const got = await this.area.get(["meta"]);
    return (got["meta"] as Meta | undefined) ?? null;
  }

  async appendEvent(type: ActivityType, entityId: string, status: string | null): Promise<ActivityEvent> {
    const ev: ActivityEvent = { id: newId(), timestamp: nowIso(), type, entityId, status };
    await this.area.set({ [keyEvent(ev.id)]: ev });
    return ev;
  }
}
