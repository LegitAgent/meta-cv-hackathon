import { useEffect, useState } from "react";
import type { Note } from "../../shared/contracts";

export type SaveState = "saved" | "saving" | "error" | "conflict";

export function NoteTabs({
  notes,
  openNoteIds,
  activeNoteId,
  onSelect,
  onCreate,
  onClose,
  onDelete,
  onRename,
  draft,
  onDraftChange,
  saveState,
  conflictNote,
  onResolveConflict,
}: {
  notes: Note[];
  openNoteIds: string[];
  activeNoteId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
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
                    if (e.key === "Enter") {
                      onRename(id, editTitle || n.title);
                      setEditingTab(null);
                    }
                  }}
                />
              ) : (
                <span
                  onClick={() => onSelect(id)}
                  onDoubleClick={() => {
                    setEditingTab(id);
                    setEditTitle(n.title);
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
          draft={draft}
          onDraftChange={onDraftChange}
          saveState={saveState}
          onDelete={onDelete}
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

      <SavedNotes notes={notes} openNoteIds={openNoteIds} onSelect={onSelect} onDelete={onDelete} />
    </section>
  );
}

function NoteEditor({
  note,
  draft,
  onDraftChange,
  saveState,
  onDelete,
}: {
  note: Note;
  draft: { title: string; body: string };
  onDraftChange: (d: { title: string; body: string }) => void;
  saveState: SaveState;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="editor">
      <input
        className="note-title"
        value={draft.title}
        onChange={(e) => onDraftChange({ title: e.target.value, body: draft.body })}
        aria-label="Note title"
      />
      <textarea
        value={draft.body}
        onChange={(e) => onDraftChange({ title: draft.title, body: e.target.value })}
        rows={8}
        aria-label="Note body"
      />
      <div className="row between">
        <span className="save-state" data-state={saveState}>
          {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "conflict" ? "Conflict" : "Save error"}
        </span>
        <button
          className="link danger"
          onClick={() => {
            if (window.confirm(`Delete note “${note.title}”? This is a separate confirmed action.`)) onDelete(note.id);
          }}
        >
          Delete note
        </button>
      </div>
    </div>
  );
}

export function SavedNotes({
  notes,
  openNoteIds,
  onSelect,
  onDelete,
}: {
  notes: Note[];
  openNoteIds: string[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const closed = notes.filter((n) => !openNoteIds.includes(n.id));
  const [q, setQ] = useState("");
  const filtered = closed.filter((n) => n.title.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => {
    setQ("");
  }, [closed.length]);
  if (closed.length === 0) return null;
  return (
    <div className="saved-notes">
      <h4>Saved notes</h4>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter saved notes" aria-label="Filter saved notes" />
      <ul>
        {filtered.map((n) => (
          <li key={n.id}>
            <button className="link" onClick={() => onSelect(n.id)}>
              {n.title}
            </button>
            <button
              className="link danger"
              onClick={() => {
                if (window.confirm(`Delete note “${n.title}”?`)) onDelete(n.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
