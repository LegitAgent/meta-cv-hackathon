import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Checkpoint, Note, SummaryJob } from "../shared/contracts";
import { postSummary } from "./api";
import { mergeSavedNote, sendCommand, snapshotFromStorage, type PanelSnapshot } from "./store";
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
  const saveTimer = useRef<number | null>(null);
  const pendingDraft = useRef<{ title: string; body: string } | null>(null);
  const savingRef = useRef(false);
  // Refs keep the save path stable so timers never fire with a stale revision.
  const draftRef = useRef(draft);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
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

  // When the active note changes (or a remote update lands and the local
  // draft is clean), adopt the stored note as the draft basis.
  useEffect(() => {
    if (!activeNote) {
      setDraft({ id: null, title: "", body: "", baseRevision: 0 });
      return;
    }
    setDraft((d) => {
      const dirty = pendingDraft.current !== null || savingRef.current;
      if (d.id !== activeNote.id || !dirty) {
        return { id: activeNote.id, title: activeNote.title, body: activeNote.body, baseRevision: activeNote.revision };
      }
      return d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id, activeNote?.revision]);

  // Stable save path: reads the latest draft from a ref so retries and
  // timers never send a stale baseRevision, and a completed save never
  // clobbers typing that arrived while it was in flight.
  const flushSave = useCallback(async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const text = pendingDraft.current;
    pendingDraft.current = null;
    if (!text) return;
    const latest = draftRef.current;
    const id = latest.id;
    if (!id) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const { note } = await sendCommand<{ note: Note }>({
        type: "NOTE_UPDATE",
        id,
        baseRevision: latest.baseRevision,
        title: text.title,
        body: text.body,
      });
      // Adopt the new revision, but keep newer typing on screen.
      setDraft(mergeSavedNote(note, pendingDraft.current));
      setSaveState("saved");
      setConflictNote(null);
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      // Never drop the in-flight text, and never overwrite newer typing that
      // arrived during the save with the failed in-flight text.
      if (pendingDraft.current === null) pendingDraft.current = text;
      if (code === "REVISION_CONFLICT") {
        // Preserve the user's draft; ask them to resolve.
        const current = await chrome.storage.local
          .get([`note:${id}`])
          .then((g) => (g as Record<string, Note>)[`note:${id}`])
          .catch(() => null);
        setConflictNote(current ?? null);
        setSaveState("conflict");
      } else {
        setSaveState("error");
      }
    } finally {
      savingRef.current = false;
      // A newer draft arrived while saving: schedule another save.
      if (pendingDraft.current) {
        saveTimer.current = window.setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
      }
    }
  }, []);

  useEffect(() => {
    draftRef.current = draft;
  });
  useEffect(() => {
    flushRef.current = flushSave;
  }, [flushSave]);

  const onDraftChange = useCallback(
    (d: { title: string; body: string }) => {
      setDraft((prev) => ({ ...prev, title: d.title, body: d.body }));
      pendingDraft.current = d;
      setSaveState((s) => (s === "saved" || s === "error" ? "saving" : s));
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    },
    [],
  );

  // Flush on tab switch / explicit close.
  const selectNote = useCallback(
    async (id: string) => {
      await flushSave();
      await sendCommand({ type: "WORKSPACE_UPDATE", fields: { activeNoteId: id } });
      const ws = snap?.workspace;
      if (ws && !ws.openNoteIds.includes(id)) {
        await sendCommand({ type: "WORKSPACE_UPDATE", fields: { openNoteIds: [...ws.openNoteIds, id], activeNoteId: id } });
      }
      await refresh();
    },
    [flushSave, refresh, snap?.workspace],
  );

  const selectedCheckpoint: Checkpoint | null = useMemo(() => {
    if (!snap) return null;
    return snap.checkpoints.find((c) => c.id === snap.workspace.selectedCheckpointId) ?? snap.checkpoints[0] ?? null;
  }, [snap]);
  const selectedJob: SummaryJob | null = (selectedCheckpoint && snap?.summaries[selectedCheckpoint.id]) || null;

  const runSummary = useCallback(
    async (checkpointId: string) => {
      if (busySummary) return;
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
    [busySummary, includeNoteIds, refresh, snap?.workspace.backendUrl],
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
    async (checkpointId: string, code: string) => {
      const checkpoint = snap?.checkpoints.find((c) => c.id === checkpointId);
      const trimmed = code.slice(0, 50000);
      if (!trimmed.trim()) return;
      const { note } = await sendCommand<{ note: Note }>({
        type: "NOTE_CREATE",
        title: `Pasted code — ${checkpoint?.title ?? "checkpoint"}`.slice(0, 300),
        linkedCheckpointId: checkpointId,
        body: trimmed,
      });
      setIncludeNoteIds((ids) => (ids.includes(note.id) ? ids : [...ids, note.id]));
      await refresh();
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
            onPasteCode={(code) => selectedCheckpoint && void pasteCode(selectedCheckpoint.id, code)}
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
          onCreate={() => void sendCommand({ type: "NOTE_CREATE", title: "Untitled note" }).then(() => refresh())}
          onClose={async (id) => {
            await flushSave();
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
              pendingDraft.current = null;
              setDraft({ id: conflictNote.id, title: conflictNote.title, body: conflictNote.body, baseRevision: conflictNote.revision });
              setConflictNote(null);
              setSaveState("saved");
            } else if (keep === "mine" && draft.id && pendingDraft.current) {
              const current = conflictNote;
              setConflictNote(null);
              if (current) {
                // Force-save over the newer revision after explicit choice.
                setDraft((d) => ({ ...d, baseRevision: current.revision }));
                saveTimer.current = window.setTimeout(() => void flushSave(), AUTOSAVE_MS);
              }
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
        />
      )}

      <footer>
        <button className="link" onClick={() => void exportJson()}>
          Export JSON
        </button>
        <span className="meta">Local-only storage · backend {snap.workspace.backendUrl}</span>
      </footer>
    </div>
  );
}
