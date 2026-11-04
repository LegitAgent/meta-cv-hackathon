import { useEffect, useMemo, useRef, useState } from "react";
import type { Note, NoteFolder } from "../../shared/contracts";
import { renderPreview, toggleBullets, wrapInline } from "./noteFormat";

export type SaveState = "saved" | "saving" | "error" | "conflict";

export function NoteTabs({
  notes,
  folders,
  openNoteIds,
  activeNoteId,
  onSelect,
  onCreate,
  onClose,
  onDelete,
  onRename,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveNote,
  draft,
  onDraftChange,
  saveState,
  conflictNote,
  onResolveConflict,
}: {
  notes: Note[];
  folders: NoteFolder[];
  openNoteIds: string[];
  activeNoteId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveNote: (id: string, folderId: string | null) => void;
  draft: { title: string; body: string };
  onDraftChange: (d: { title: string; body: string }) => void;
  saveState: SaveState;
  conflictNote: Note | null;
  onResolveConflict: (keep: "mine" | "theirs") => void;
}) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const active = activeNoteId ? byId.get(activeNoteId) ?? null : null;

  return (
    <section className="card">
      <div className="tabs" role="tablist">
        {openNoteIds.map((id) => {
          const n = byId.get(id);
          if (!n) return null;
          return (
            <div key={id} role="tab" aria-selected={id === activeNoteId} className={id === activeNoteId ? "tab active" : "tab"}>
              {editingTab === id ? (
                <input
                  value={editTitle}
                  autoFocus
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => {
                    onRename(id, editTitle || n.title);
                    setEditingTab(null);
                  }}
                  onKeyDown={(e) => {
                    // Let blur do the single commit; calling onRename here too
                    // fires it twice (Enter, then unmount blur).
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              ) : (
                <span
                  tabIndex={0}
                  onClick={() => onSelect(id)}
                  onDoubleClick={() => {
                    setEditingTab(id);
                    setEditTitle(n.title);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(id);
                    } else if (e.key === "F2") {
                      setEditingTab(id);
                      setEditTitle(n.title);
                    }
                  }}
                  title="Double-click to rename"
                >
                  {n.title}
                </span>
              )}
              <button className="link" title="Close tab (keeps the note)" onClick={() => onClose(id)}>
                ×
              </button>
            </div>
          );
        })}
        <button onClick={onCreate}>+ Note</button>
      </div>

      {active ? (
        <NoteEditor
          note={active}
          folders={folders}
          draft={draft}
          onDraftChange={onDraftChange}
          saveState={saveState}
          onDelete={onDelete}
          onMoveNote={onMoveNote}
        />
      ) : (
        <div className="empty">No note open. Create one, or reopen a saved note below.</div>
      )}

      {saveState === "conflict" && conflictNote && (
        <div className="error">
          Another panel saved “{conflictNote.title}” first. Your draft is preserved.
          <div className="row">
            <button onClick={() => onResolveConflict("mine")}>Keep my draft</button>
            <button onClick={() => onResolveConflict("theirs")}>Use saved version</button>
          </div>
        </div>
      )}

      <FoldersCard
        folders={folders}
        notes={notes}
        onCreateFolder={onCreateFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
      />
      <SavedNotes notes={notes} folders={folders} openNoteIds={openNoteIds} onSelect={onSelect} onDelete={onDelete} onMoveNote={onMoveNote} />
    </section>
  );
}

function NoteEditor({
  note,
  folders,
  draft,
  onDraftChange,
  saveState,
  onDelete,
  onMoveNote,
}: {
  note: Note;
  folders: NoteFolder[];
  draft: { title: string; body: string };
  onDraftChange: (d: { title: string; body: string }) => void;
  saveState: SaveState;
  onDelete: (id: string) => void;
  onMoveNote: (id: string, folderId: string | null) => void;
}) {
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [preview, setPreview] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => {
    setConfirmingDelete(false);
  }, [note.id]);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [dictateError, setDictateError] = useState<string | null>(null);
  const recognitionRef = useRef<{ stop(): void; abort(): void } | null>(null);
  const stopIntentRef = useRef(false);
  const insertAtRef = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const recognitionWindow = typeof window !== "undefined"
    ? (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
    : {};
  const recognitionSupported = Boolean(recognitionWindow.SpeechRecognition || recognitionWindow.webkitSpeechRecognition);
  useEffect(() => {
    return () => {
      try {
        // Our own abort surfaces as an "aborted" error below; mark the
        // intent so it is never shown as a microphone problem.
        stopIntentRef.current = true;
        recognitionRef.current?.abort();
      } catch {
        // Recognition never started; nothing to stop.
      }
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
      setDictateError(null);
    };
  }, [note.id]);
  function toggleDictation() {
    if (listening) {
      try {
        // Manual stop can still flush a trailing error (e.g. no-speech for
        // trailing silence); it is not a microphone problem.
        stopIntentRef.current = true;
        recognitionRef.current?.stop();
      } finally {
        setListening(false);
        setInterim("");
      }
      return;
    }
    const Ctor = (recognitionWindow.SpeechRecognition || recognitionWindow.webkitSpeechRecognition) as
      | (new () => {
        lang: string; continuous: boolean; interimResults: boolean;
        onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void) | null;
        onerror: ((event: { error?: string }) => void) | null; onend: (() => void) | null;
        start(): void; stop(): void; abort(): void;
      })
      | undefined;
    if (!Ctor) return;
    const recog = new Ctor();
    recog.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
    recog.continuous = true;
    recog.interimResults = true;
    const el = bodyRef.current;
    // Insert at the caret only when the field actually has focus; otherwise
    // append at the end instead of surprising the user at position zero.
    const focused = typeof document !== "undefined" && !!el && document.activeElement === el;
    insertAtRef.current = focused && el?.selectionStart != null ? el.selectionStart : draftRef.current.body.length;
    let offset = 0;
    recog.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += text;
        else interimText += text;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        const cur = draftRef.current.body;
        const at = Math.min(insertAtRef.current + offset, cur.length);
        const sep = at > 0 && !/\s$/.test(cur.slice(0, at)) ? " " : "";
        const spoken = finalText.trim();
        offset += (sep + spoken).length;
        onDraftChange({ title: draftRef.current.title, body: cur.slice(0, at) + sep + spoken + cur.slice(at) });
      }
    };
    recog.onerror = (event) => {
      const code = typeof event?.error === "string" ? event.error : "";
      setListening(false);
      setInterim("");
      // Our own stop/abort and the browser's auto-stop surface as errors;
      // none of them mean the microphone is broken.
      if (code === "aborted" || stopIntentRef.current) return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        setDictateError("Microphone blocked: allow microphone access for this extension, then try again.");
      } else if (code === "no-speech") {
        setDictateError("Didn't catch that — speak and try again.");
      } else if (code === "audio-capture") {
        setDictateError("No microphone found, or it is busy in another app.");
      } else if (code === "network") {
        setDictateError("Dictation needs a network connection — check yours and retry.");
      } else if (code === "language-not-supported") {
        setDictateError("Dictation does not support this browser language.");
      } else {
        setDictateError("Dictation stopped unexpectedly — try again.");
      }
    };
    recog.onend = () => {
      stopIntentRef.current = false;
      setListening(false);
      setInterim("");
      recognitionRef.current = null;
    };
    recognitionRef.current = recog;
    try {
      recog.start();
      setListening(true);
      setDictateError(null);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }
  function applyFormat(format: (body: string, sel: { start: number; end: number }) => { body: string; selection: { start: number; end: number } }) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? draft.body.length;
    const next = format(draft.body, { start, end });
    onDraftChange({ title: draft.title, body: next.body });
    requestAnimationFrame(() => {
      const target = bodyRef.current;
      if (target) {
        target.focus();
        target.setSelectionRange(next.selection.start, next.selection.end);
      }
    });
  }
  return (
    <div className="editor">
      <input
        className="note-title"
        value={draft.title}
        onChange={(e) => onDraftChange({ title: e.target.value, body: draft.body })}
        aria-label="Note title"
      />
      <div className="row">
        <label className="history-select">
          Folder{" "}
          <select
            value={note.folderId ?? ""}
            onChange={(e) => onMoveNote(note.id, e.target.value === "" ? null : e.target.value)}
            aria-label="Note folder"
          >
            <option value="">Unfiled</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row format-bar" role="toolbar" aria-label="Text formatting">
        <button className="link" title="Bold" aria-label="Bold" onClick={() => applyFormat((body, sel) => wrapInline(body, sel, "**"))}><strong>B</strong></button>
        <button className="link" title="Italic" aria-label="Italic" onClick={() => applyFormat((body, sel) => wrapInline(body, sel, "*"))}><em>I</em></button>
        <button className="link" title="Bulleted list" aria-label="Bulleted list" onClick={() => applyFormat(toggleBullets)}>List</button>
        <button className="link" aria-pressed={preview} onClick={() => setPreview((v) => !v)}>{preview ? "Edit" : "Preview"}</button>
        {recognitionSupported && (listening
          ? <button className="link" aria-label="Stop dictation" title="Stop dictation" onClick={toggleDictation}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ verticalAlign: "-3px" }}>
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          : <button className="link" aria-label="Dictate note" title="Dictate note" onClick={toggleDictation}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ verticalAlign: "-3px" }}>
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h4v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </button>)}
      </div>
      {listening && (
        <p className="hint" role="status">
          Listening… press Stop when done.{interim ? ` Heard: ${interim}` : ""}
        </p>
      )}
      {dictateError && !listening && (
        <p className="error" role="alert">
          {dictateError}{" "}
          <button className="link" aria-label="Dismiss dictation error" onClick={() => setDictateError(null)}>
            Dismiss
          </button>
        </p>
      )}
      {preview ? (
        <div className="preview" aria-label="Note preview" dangerouslySetInnerHTML={{ __html: renderPreview(draft.body) }} />
      ) : (
        <textarea
          ref={bodyRef}
          value={draft.body}
          onChange={(e) => onDraftChange({ title: draft.title, body: e.target.value })}
          rows={8}
          aria-label="Note body"
        />
      )}
      <div className="row between">
        <span className="save-state" data-state={saveState}>
          {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "conflict" ? "Conflict" : "Save error"}
        </span>
        {confirmingDelete ? (
          <span className="history-confirm" role="alert">
            <span>Delete “{note.title}”? This cannot be undone.</span>
            <span className="row">
              <button className="danger" onClick={() => onDelete(note.id)}>
                Delete
              </button>
              <button onClick={() => setConfirmingDelete(false)}>Keep</button>
            </span>
          </span>
        ) : (
          <button className="link danger" onClick={() => setConfirmingDelete(true)}>
            Delete note
          </button>
        )}
      </div>
    </div>
  );
}

export function FoldersCard({
  folders,
  notes,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  folders: NoteFolder[];
  notes: Note[];
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.folderId != null) map.set(n.folderId, (map.get(n.folderId) ?? 0) + 1);
    }
    return map;
  }, [notes]);
  return (
    <div className="saved-notes">
      <h4>Folders</h4>
      <div className="row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New folder name"
          aria-label="New folder name"
          maxLength={100}
        />
        <button
          disabled={!name.trim()}
          onClick={() => {
            onCreateFolder(name.trim());
            setName("");
          }}
        >
          + Folder
        </button>
      </div>
      {folders.length > 0 && (
        <ul>
          {folders.map((f) => {
            const count = counts.get(f.id) ?? 0;
            return (
              <li key={f.id}>
                {editingId === f.id ? (
                  <input
                    value={editName}
                    autoFocus
                    maxLength={100}
                    aria-label="Folder name"
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => {
                      onRenameFolder(f.id, editName.trim() || f.name);
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                ) : (
                  <span title="Double-click to rename" onDoubleClick={() => { setEditingId(f.id); setEditName(f.name); }}>
                    {f.name}
                  </span>
                )}
                <span className="meta"> · {count} note{count === 1 ? "" : "s"}</span>
                {confirmId === f.id ? (
                  <span className="history-confirm" role="alert">
                    <span>Delete “{f.name}”? Notes move to Unfiled.</span>
                    <span className="row">
                      <button
                        className="danger"
                        onClick={() => {
                          onDeleteFolder(f.id);
                          setConfirmId(null);
                        }}
                      >
                        Delete
                      </button>
                      <button onClick={() => setConfirmId(null)}>Keep</button>
                    </span>
                  </span>
                ) : (
                  <button className="link danger" onClick={() => setConfirmId(f.id)}>
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SavedNotes({
  notes,
  folders,
  openNoteIds,
  onSelect,
  onDelete,
  onMoveNote,
}: {
  notes: Note[];
  folders: NoteFolder[];
  openNoteIds: string[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveNote: (id: string, folderId: string | null) => void;
}) {
  const byFolderId = new Map(folders.map((f) => [f.id, f.name]));
  const closed = notes.filter((n) => !openNoteIds.includes(n.id));
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sort, setSort] = useState<"updated" | "created" | "title">("updated");
  const filtered = closed
    .filter((n) => n.title.toLowerCase().includes(q.toLowerCase()))
    .filter((n) => folder === "" || (folder === "none" ? n.folderId == null : n.folderId === folder))
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : sort === "created" ? (a.createdAt < b.createdAt ? 1 : -1) : (a.updatedAt < b.updatedAt ? 1 : -1));
  useEffect(() => {
    setQ("");
  }, [closed.length]);
  if (closed.length === 0) return null;
  return (
    <div className="saved-notes">
      <h4>Saved notes</h4>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter saved notes" aria-label="Filter saved notes" />
        <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Filter saved notes by folder">
          <option value="">All folders</option>
          <option value="none">Unfiled</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as "updated" | "created" | "title")} aria-label="Sort saved notes">
          <option value="updated">Last updated</option>
          <option value="created">Newest first</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>
      {closed.length > 0 && filtered.length === 0 && (
        <div className="empty">No saved notes match this filter.</div>
      )}
      <ul>
        {filtered.map((n) => (
          <li key={n.id}>
            <button className="link" onClick={() => onSelect(n.id)}>
              {n.title}
            </button>
            <span className="meta"> · {n.folderId != null ? (byFolderId.get(n.folderId) ?? "Unfiled") : "Unfiled"}</span>
            <select
              value={n.folderId ?? ""}
              onChange={(e) => onMoveNote(n.id, e.target.value === "" ? null : e.target.value)}
              aria-label={`Move ${n.title} to folder`}
            >
              <option value="">Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            {confirmId === n.id ? (
              <span className="history-confirm" role="alert">
                <span>Delete “{n.title}”?</span>
                <span className="row">
                  <button
                    className="danger"
                    onClick={() => {
                      onDelete(n.id);
                      setConfirmId(null);
                    }}
                  >
                    Delete
                  </button>
                  <button onClick={() => setConfirmId(null)}>Keep</button>
                </span>
              </span>
            ) : (
              <button className="link danger" onClick={() => setConfirmId(n.id)}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
