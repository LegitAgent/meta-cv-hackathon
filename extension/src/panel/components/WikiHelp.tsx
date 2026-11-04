import { useEffect, useRef } from "react";

// In-app docs: one short article per topic with a contents list.
// Keep each article to two or three paragraphs; this renders in a modal.
const ARTICLES = [
  {
    id: "wiki-saving",
    title: "Saving pages",
    body: [
      "Press Save this page to capture the current tab as a checkpoint. Optionally type where you are stuck first; it is stored with the checkpoint so the recap knows what you were wrestling with. Saving captures the page text, your selected text, editor code when it can be read, and a small screenshot.",
      "After saving you will see a Saved mark with the capture time. Press Save again to store a fresh checkpoint; earlier ones are kept, never overwritten. Pages that cannot be captured, such as browser settings pages, explain why instead of saving. Switching browser tabs jumps to that tab's checkpoint, so capture a page first to include it.",
    ],
  },
  {
    id: "wiki-recaps",
    title: "Recaps",
    body: [
      "Generate recap asks the AI to summarize the selected checkpoint: what you were working on, what you tried, and one suggested next action. Recaps need sign-in with a Google account and AI enabled. If a recap fails, Retry summary tries again without touching the checkpoint.",
      "The recap keeps the checkpoint's page link, so Reopen source takes you back to the exact page. Copy code copies the captured code block, and when capture missed your code you can paste it as a linked note instead. Related saves from the same task appear under Back to where I was. Tick Summarize new captures automatically to recap each save without pressing the button.",
    ],
  },
  {
    id: "wiki-notes",
    title: "Notes",
    body: [
      "Press + Note for a blank note; it autosaves as you type and the indicator shows Saved once storage confirms. The toolbar adds bold, italic, and bulleted lists, and Preview renders the formatting. Use the filter box to find notes and the sort menu to order them by last updated, newest, or title.",
      "If another panel saved first you get a conflict banner: Keep my draft retries over the newer revision, Use saved version discards your text. Closing a tab with × hides it but keeps the note in Saved notes; Delete removes it for good. Ticking notes under Notes to include attaches their exact text to the next recap.",
    ],
  },
  {
    id: "wiki-history",
    title: "History and account",
    body: [
      "History lists every checkpoint with its capture quality. Select one to resume it; a failed recap shows Retry, and Delete removes a single checkpoint while linked notes are kept. Tick rows to delete several at once, and Export JSON downloads checkpoints, notes, and history for backup. Everything lives on this device.",
      "Sign in with Google unlocks recaps; your short-lived token stays in Chrome session storage and is never stored with your notes. Switch Google account changes who you sign in as, and Sign out turns AI features off while notes and captures keep working.",
    ],
  },
];

export function WikiHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="wiki-overlay" onClick={onClose}>
      <div
        className="wiki-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Backtrack guide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between">
          <h3>Backtrack guide</h3>
          <button type="button" onClick={onClose} aria-label="Close guide">
            Close
          </button>
        </div>
        <p className="wiki-standfirst">
          Backtrack saves where you were so you can resume after getting distracted.
          Capture the tab in one click, jot local notes, and generate a short AI recap
          only when you ask for it.
        </p>
        <nav className="wiki-toc" aria-label="On this page">
          <span>On this page</span>
          <ul>
            {ARTICLES.map((a) => (
              <li key={a.id}>
                <a href={`#${a.id}`}>{a.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="wiki-body">
          {ARTICLES.map((a) => (
            <article key={a.id} id={a.id}>
              <h2>{a.title}</h2>
              {a.body.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
