// Core Backtrack contracts. Storage keys (chrome.storage.local):
// meta | workspace | checkpoint:<uuid> | summary:<checkpointId>
// | note:<uuid> | event:<uuid>

export type QualityCode = "complete" | "partial" | "unavailable";

export interface Quality {
  code: QualityCode;
  missingFields: string[];
  truncatedFields: string[];
  warnings: string[];
}

export type AdapterKind = "generic" | "leetcode";

export interface Checkpoint {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  taskKey: string;
  title: string;
  url: string;
  adapter: AdapterKind;
  pageText: string;
  selectedText: string;
  code: string | null;
  language: string | null;
  screenshot: string | null;
  quality: Quality;
}

export interface Note {
  id: string;
  revision: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  linkedCheckpointId: string | null;
  kind?: "codeOverride";
}

export interface NoteSnapshot {
  id: string;
  revision: number;
  body: string;
  kind?: "codeOverride";
  linkedCheckpointId?: string | null;
}

export type SummaryStatus = "idle" | "pending" | "complete" | "failed";

export interface ObservedFact {
  text: string;
  sourceFields: string[];
}

export interface Summary {
  recap: string;
  observedFacts: ObservedFact[];
  possibleBlocker: string | null;
  nextAction: string;
  uncertainties: string[];
}

export interface SummaryJob {
  checkpointId: string;
  requestId: string | null;
  status: SummaryStatus;
  startedAt: string | null;
  includedNoteSnapshots: NoteSnapshot[];
  result: Summary | null;
  error: { code: string; message: string; retryAfterSeconds?: number } | null;
  warnings: string[];
}

export interface Workspace {
  openNoteIds: string[];
  activeNoteId: string | null;
  selectedCheckpointId: string | null;
  aiEnabled: boolean;
  autoSummarize: boolean;
  backendUrl: string;
}

export interface Meta {
  schemaVersion: 1;
  createdAt: string;
}

export type ActivityType =
  | "checkpoint.captured"
  | "checkpoint.resumed"
  | "checkpoint.deleted"
  | "summary.completed"
  | "summary.failed"
  | "note.created"
  | "note.deleted";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: ActivityType;
  entityId: string;
  status: string | null;
}

export interface LastCapture {
  ok: boolean;
  at: string;
  checkpointId: string | null;
  code: string | null;
  message: string | null;
}

export type WorkerCommand =
  | { type: "NOTE_CREATE"; title: string; linkedCheckpointId?: string | null; body?: string; kind?: "codeOverride" }
  | { type: "NOTE_UPDATE"; id: string; baseRevision: number; title: string; body: string }
  | { type: "NOTE_CLOSE"; id: string }
  | { type: "NOTE_DELETE"; id: string }
  | { type: "WORKSPACE_UPDATE"; fields: Partial<Workspace> }
  | { type: "SUMMARY_BEGIN"; checkpointId: string; noteIds: string[] }
  | { type: "SUMMARY_COMPLETE"; checkpointId: string; requestId: string; result: Summary }
  | { type: "SUMMARY_FAIL"; checkpointId: string; requestId: string; error: { code: string; message: string } }
  | { type: "CHECKPOINT_DELETE"; id: string }
  | { type: "CAPTURE" };

export type WorkerResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };

// Backend wire shapes (subset of checkpoint sent to the proxy).
export interface SummaryRequestPayload {
  requestId: string;
  checkpoint: {
    id: string;
    title: string;
    pageText: string;
    selectedText: string;
    code: string | null;
    language: string | null;
    screenshot: string | null;
    quality: Quality;
  };
  notes: { id: string; body: string }[];
}

export const LIMITS = {
  PAGE_TEXT_MAX: 20000,
  CODE_MAX: 30000,
  SELECTED_MAX: 5000,
  NOTES_TOTAL_MAX: 10000,
  SCREENSHOT_MAX: 120000,
  BODY_BYTES_MAX: 256 * 1024,
} as const;

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
