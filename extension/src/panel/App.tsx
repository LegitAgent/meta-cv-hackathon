import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Checkpoint, Note, SummaryJob } from "../shared/contracts";
import { postSummary } from "./api";
import { ConnectionSettings } from "./components/ConnectionSettings";
import {
  mergeSavedNote,
  resolveAdoptedDraft,
  sendCommand,
  shouldClaimSaved,
  shouldRetrySave,
  snapshotFromStorage,
  type PanelSnapshot,
  type PendingEdit,
} from "./store";
import { ResumeView, SummaryCard } from "./components/ResumeView";
import { NoteTabs, type SaveState } from "./components/NoteTabs";
import { HistoryView } from "./components/HistoryView";

type View = "resume" | "notes" | "history";

const AUTOSAVE_MS = 400;

export default function App() {
  const [snap, setSnap] = useState<PanelSnapshot | null>(null);
  const [view, setView] = useState<View>("resume");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busySummary, setBusySummary] = useState(false);
  const [includeNoteIds, setIncludeNoteIds] = useState<string[]>([]);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const autoRanFor = useRef<string | null>(null);

  // Panel owns the live note draft; storage is only updated on debounced save.
  const [draft, setDraft] = useState<{ id: string | null; title: string; body: string; baseRevision: number }>({
    id: null,
    title: "",
    body: "",
    baseRevision: 0,
  });
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflictNote, setConflictNote] = useState<Note | null>(null);
  const [conflictText, setConflictText] = useState<{ id: string; title: string; body: string } | null>(null);
  const saveTimer = useRef<number | null>(null);
  // Per-note outbox: unsent edits keyed by originating note ID. Text can
  // never cross note boundaries because every send and every display merge
  // is keyed by the note the text was typed in.
  const outbox = useRef(new Map<string, PendingEdit>());
  const inFlightSave = useRef<Promise<boolean> | null>(null);
  const conflictedNoteId = useRef<string | null>(null);
  // Refs keep the save path stable so timers never fire with a stale revision.
  const draftRef = useRef(draft);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  // AI consent and auto-summarize live in the persisted workspace, so a panel
  // reload never resets them.
  const aiEnabled = snap?.workspace.aiEnabled ?? false;
  const autoSummarize = snap?.workspace.autoSummarize ?? false;

  const refresh = useCallback(async () => {
    try {
      const all = await chrome.storage.local.get(null);
      setSnap(snapshotFromStorage(all as Record<string, unknown>));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load local data.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);

  const activeNote: Note | null = useMemo(() => {
    if (!snap) return null;
    const id = snap.workspace.activeNoteId;
    return (id && snap.notes.find((n) => n.id === id)) || null;
  }, [snap]);

  // Adopt the stored note on switch/remote update. Pending text shows only
  // when it belongs to the incoming note, so edits never cross boundaries.
  useEffect(() => {
    const pending = activeNote ? outbox.current.get(activeNote.id) ?? null : null;
    setDraft(
      resolveAdoptedDraft(
        activeNote,
        pending && activeNote ? { id: activeNote.id, title: pending.title, body: pending.body } : null,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id, activeNote?.revision]);

  // One in-flight save at a time. Each send carries the originating note ID
  // and base revision; each response merges only into the matching display.
  // A completed save never clobbers typing that arrived while in flight, and
  // revision conflicts never auto-retry: the user resolves them explicitly.
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (inFlightSave.current) return inFlightSave.current;
    if (conflictedNoteId.current) return false;
    // Prefer the displayed note so visible feedback lands first.
    const curId = draftRef.current.id;
    let key: string | undefined;
    if (curId && outbox.current.has(curId)) key = curId;
    else key = outbox.current.keys().next().value as string | undefined;
    if (key === undefined) return true;
    const text = outbox.current.get(key);
    if (!text) return true;
    outbox.current.delete(key);
    setSaveState("saving");
    const operation = (async (): Promise<boolean> => {
    try {
      const { note } = await sendCommand<{ note: Note }>({
        type: "NOTE_UPDATE",
        id: key,
        baseRevision: text.baseRevision,
        title: text.title,
        body: text.body,
      });
      const newer = outbox.current.get(note.id);
      if (newer) outbox.current.set(note.id, { ...newer, baseRevision: note.revision });
      // Merge only into the matching display; other notes are untouched.
      // Newer same-note typing stays on screen under the new revision.
      setDraft((d) => {
        if (d.id !== note.id) return d;
        const newer = outbox.current.get(note.id);
        return mergeSavedNote(note, newer ? { title: newer.title, body: newer.body } : null);
      });
      if (shouldClaimSaved(outbox.current.size)) setSaveState("saved");
      setConflictNote(null);
      setConflictText(null);
      return true;
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "REVISION_CONFLICT") {
        conflictedNoteId.current = key;
        // Hold the failed text for explicit resolution; it is NOT requeued,
        // so conflicts never retry on their own.
        const latest = outbox.current.get(key) ?? text;
        outbox.current.delete(key);
        setConflictText({ id: key, title: latest.title, body: latest.body });
        const current = await chrome.storage.local
          .get([`note:${key}`])
          .then((g) => (g as Record<string, Note>)[`note:${key}`])
          .catch(() => null);
        setConflictNote(current ?? null);
        setSaveState("conflict");
      } else {
        // Transient failure: requeue the exact text for the same note.
        if (!outbox.current.has(key)) outbox.current.set(key, text);
        setSaveState("error");
      }
      return false;
    } finally {
      inFlightSave.current = null;
      if (shouldRetrySave(Boolean(conflictedNoteId.current), outbox.current.size > 0)) {
        saveTimer.current = window.setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
      }
    }
    })();
    inFlightSave.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    draftRef.current = draft;
  });
  useEffect(() => {
    flushRef.current = flushSave;
  }, [flushSave]);

  const onDraftChange = useCallback(
    (d: { title: string; body: string }) => {
      const cur = draftRef.current;
      if (!cur.id) return;
      outbox.current.set(cur.id, { title: d.title, body: d.body, baseRevision: cur.baseRevision });
      if (conflictedNoteId.current === cur.id) setConflictText({ id: cur.id, title: d.title, body: d.body });
      setDraft((prev) => ({ ...prev, title: d.title, body: d.body }));
      setSaveState((s) => (s === "saved" || s === "error" ? "saving" : s));
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    },
    [],
  );

  // Drain every queued note before leaving it, so no text is left behind.
  const drainOutbox = useCallback(async (): Promise<boolean> => {
    for (let guard = 0; guard < 50 && (outbox.current.size > 0 || inFlightSave.current); guard++) {
      if (!(await flushSave())) return false;
    }
    return outbox.current.size === 0 && !inFlightSave.current && !conflictedNoteId.current;
  }, [flushSave]);

  // Flush on tab switch / explicit close.
  const selectNote = useCallback(
    async (id: string) => {
      if (!(await drainOutbox())) return;
      await sendCommand({ type: "WORKSPACE_UPDATE", fields: { activeNoteId: id } });
      const ws = snap?.workspace;
      if (ws && !ws.openNoteIds.includes(id)) {
        await sendCommand({ type: "WORKSPACE_UPDATE", fields: { openNoteIds: [...ws.openNoteIds, id], activeNoteId: id } });
      }
      await refresh();
    },
    [drainOutbox, refresh, snap?.workspace],
  );

  const selectedCheckpoint: Checkpoint | null = useMemo(() => {
    if (!snap) return null;
    return snap.checkpoints.find((c) => c.id === snap.workspace.selectedCheckpointId) ?? snap.checkpoints[0] ?? null;
  }, [snap]);
  const selectedJob: SummaryJob | null = (selectedCheckpoint && snap?.summaries[selectedCheckpoint.id]) || null;

  const runSummary = useCallback(
    async (checkpointId: string) => {
      if (busySummary || !aiEnabled) return;
      setBusySummary(true);
      try {
        const { job, payload } = await sendCommand<{
          job: SummaryJob;
          payload: Parameters<typeof postSummary>[1];
        }>({ type: "SUMMARY_BEGIN", checkpointId, noteIds: includeNoteIds });
        const backendUrl = snap?.workspace.backendUrl ?? "http://127.0.0.1:8001";
        try {
          const res = await postSummary(backendUrl, payload);
          await sendCommand({ type: "SUMMARY_COMPLETE", checkpointId, requestId: res.requestId, result: res.summary });
        } catch (e) {
          const code = (e as Error & { code?: string }).code ?? "SUMMARY_FAILED";
          await sendCommand({
            type: "SUMMARY_FAIL",
            checkpointId,
            requestId: job.requestId ?? payload.requestId,
            error: { code, message: e instanceof Error ? e.message.slice(0, 500) : "Summary failed." },
          });
        }
      } finally {
        setBusySummary(false);
        await refresh();
      }
    },
    [busySummary, aiEnabled, includeNoteIds, refresh, snap?.workspace.backendUrl],
  );

  const setAiEnabled = useCallback(
    async (v: boolean) => {
      await sendCommand({
        type: "WORKSPACE_UPDATE",
        fields: v ? { aiEnabled: true } : { aiEnabled: false, autoSummarize: false },
      });
      await refresh();
    },
    [refresh],
  );

  const setAutoSummarize = useCallback(
    async (v: boolean) => {
      await sendCommand({ type: "WORKSPACE_UPDATE", fields: { autoSummarize: v } });
      await refresh();
    },
    [refresh],
  );

  // Paste-code fallback: checkpoints are immutable, so pasted code becomes a
  // linked note that is auto-selected for the next summary.
  const pasteCode = useCallback(
    async (checkpointId: string, code: string): Promise<boolean> => {
      const checkpoint = snap?.checkpoints.find((c) => c.id === checkpointId);
      if (!code.trim()) return false;
      if (code.length > 50000) {
        setPasteError("Pasted code exceeds the 50,000-character note limit. Shorten it before saving.");
        return false;
      }
      try {
      const { note } = await sendCommand<{ note: Note }>({
        type: "NOTE_CREATE",
        title: `Pasted code — ${checkpoint?.title ?? "checkpoint"}`.slice(0, 300),
        linkedCheckpointId: checkpointId,
        body: code,
        kind: "codeOverride",
      });
      setIncludeNoteIds((ids) => (ids.includes(note.id) ? ids : [...ids, note.id]));
      setPasteError(null);
      await refresh();
      return true;
      } catch (e) {
        setPasteError(e instanceof Error ? e.message : "Could not save pasted code.");
        return false;
      }
    },
    [refresh, snap?.checkpoints],
  );

  // One-click AI recovery: when auto-summarize is on, a fresh checkpoint gets
  // exactly one automatic summary attempt.
  useEffect(() => {
    const newest = snap?.checkpoints[0];
    if (!newest || !aiEnabled || !autoSummarize || busySummary) return;
    const job = snap?.summaries[newest.id];
    if (job && job.status !== "idle") return;
    if (autoRanFor.current === newest.id) return;
    autoRanFor.current = newest.id;
    void runSummary(newest.id);
  }, [snap?.checkpoints, snap?.summaries, aiEnabled, autoSummarize, busySummary, runSummary]);

  const exportJson = useCallback(async () => {
    const all = await chrome.storage.local.get(null);
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), records: all }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "backtrack-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (loadError) return <div className="app"><div className="error">Storage error: {loadError}</div></div>;
  if (!snap) return <div className="app"><div className="empty">Loading local workspace…</div></div>;

  return (
    <div className="app">
      <header>
        <h1>Backtrack</h1>
        <nav>
          {(["resume", "notes", "history"] as View[]).map((v) => (
            <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      {view === "resume" && (
        <>
          {snap.lastCapture && !snap.lastCapture.ok && (
            <div className="error" role="alert">
              Last capture failed ({snap.lastCapture.code}): {snap.lastCapture.message} Nothing was saved.
            </div>
          )}
          <ResumeView
            checkpoint={selectedCheckpoint}
            job={selectedJob}
            busy={busySummary}
            aiEnabled={aiEnabled}
            onAiEnabled={(v) => void setAiEnabled(v)}
            autoSummarize={autoSummarize}
            onAutoSummarize={(v) => void setAutoSummarize(v)}
            onSummarize={() => selectedCheckpoint && void runSummary(selectedCheckpoint.id)}
            onCopyCode={() => selectedCheckpoint?.code && void navigator.clipboard.writeText(selectedCheckpoint.code).catch(() => undefined)}
            onOpenSource={() => {
              const url = selectedCheckpoint?.url;
              if (!url || !/^https?:\/\//.test(url)) return;
              void chrome.tabs.create({ url });
            }}
            onPasteCode={(code) => selectedCheckpoint ? pasteCode(selectedCheckpoint.id, code) : Promise.resolve(false)}
            pasteError={pasteError}
          />
          <SummaryCard job={selectedJob} />
          <section className="card">
            <h3>Notes to include</h3>
            <p className="hint">Linking a note does not include it automatically. Select notes explicitly.</p>
            {snap.notes.length === 0 && <div className="empty">No notes yet.</div>}
            {snap.notes.map((n) => (
              <label key={n.id} className="check">
                <input
                  type="checkbox"
                  checked={includeNoteIds.includes(n.id)}
                  onChange={(e) =>
                    setIncludeNoteIds((ids) => (e.target.checked ? [...ids, n.id] : ids.filter((x) => x !== n.id)))
                  }
                />
                {n.title} (rev {n.revision})
              </label>
            ))}
          </section>
        </>
      )}

      {view === "notes" && (
        <NoteTabs
          notes={snap.notes}
          openNoteIds={snap.workspace.openNoteIds}
          activeNoteId={snap.workspace.activeNoteId}
          onSelect={(id) => void selectNote(id)}
          onCreate={() =>
            void (async () => {
              if (!(await drainOutbox())) return;
              await sendCommand({ type: "NOTE_CREATE", title: "Untitled note" });
              await refresh();
            })()
          }
          onClose={async (id) => {
            if (!(await drainOutbox())) return;
            await sendCommand({ type: "NOTE_CLOSE", id });
            await refresh();
          }}
          onDelete={async (id) => {
            await sendCommand({ type: "NOTE_DELETE", id });
            await refresh();
          }}
          onRename={async (id, title) => {
            const n = snap.notes.find((x) => x.id === id);
            if (!n) return;
            try {
              await sendCommand({ type: "NOTE_UPDATE", id, baseRevision: n.revision, title, body: n.body });
            } catch {
              // Revision conflict surfaces on next edit; draft is preserved.
            }
            await refresh();
          }}
          draft={draft.id ? { title: draft.title, body: draft.body } : { title: "", body: "" }}
          onDraftChange={onDraftChange}
          saveState={saveState}
          conflictNote={conflictNote}
          onResolveConflict={async (keep) => {
            if (keep === "theirs" && conflictNote) {
              outbox.current.delete(conflictNote.id);
              conflictedNoteId.current = null;
              setDraft({ id: conflictNote.id, title: conflictNote.title, body: conflictNote.body, baseRevision: conflictNote.revision });
              setConflictNote(null);
              setConflictText(null);
              setSaveState("saved");
            } else if (keep === "mine" && conflictNote && conflictText) {
              // Explicit user choice: requeue over the newer revision.
              outbox.current.set(conflictText.id, {
                title: conflictText.title,
                body: conflictText.body,
                baseRevision: conflictNote.revision,
              });
              conflictedNoteId.current = null;
              setConflictNote(null);
              setConflictText(null);
              setSaveState("saving");
              if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
              saveTimer.current = window.setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
            }
          }}
        />
      )}

      {view === "history" && (
        <HistoryView
          checkpoints={snap.checkpoints}
          summaries={snap.summaries}
          events={snap.events}
          selectedId={snap.workspace.selectedCheckpointId}
          onSelect={(id) => void sendCommand({ type: "WORKSPACE_UPDATE", fields: { selectedCheckpointId: id } }).then(() => refresh())}
          onDelete={async (id) => {
            await sendCommand({ type: "CHECKPOINT_DELETE", id });
            await refresh();
          }}
          onRetry={(id) => void runSummary(id)}
          aiEnabled={aiEnabled}
        />
      )}

      <ConnectionSettings backendUrl={snap.workspace.backendUrl} onSaved={refresh} />
      <footer>
        <button className="link" onClick={() => void exportJson()}>
          Export JSON
        </button>
        <span className="meta">Notes saved locally · backend {snap.workspace.backendUrl}</span>
      </footer>
    </div>
  );
}
