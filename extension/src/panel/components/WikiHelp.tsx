import { useEffect } from "react";

// In-app guide: what Backtrack is for and what each button does.
// Keep each section short; this renders in a narrow side panel.
export function WikiHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="wiki-overlay" onClick={onClose}>
      <div
        className="wiki-dialog"
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
        <div className="wiki-body">
          <section>
            <h4>Goal</h4>
            <p>
              Backtrack saves where you were so you can resume after getting distracted.
              Capture the tab in one click, jot local notes, and generate a short AI recap
              only when you ask for it. Notes stay on this device; only recap requests
              leave it, and only after you sign in.
            </p>
          </section>
          <section>
            <h4>Capture</h4>
            <dl>
              <dt>Save this page</dt>
              <dd>Captures the current tab as a checkpoint.</dd>
              <dt>Saved ✓ / Save again</dt>
              <dd>This tab already has a checkpoint. Saving again stores a fresh one; old ones are kept.</dd>
            </dl>
          </section>
          <section>
            <h4>Recap</h4>
            <dl>
              <dt>Generate recap / Retry summary</dt>
              <dd>Asks the AI for a recap of the selected checkpoint. Needs sign-in.</dd>
              <dt>Reopen source</dt>
              <dd>Opens the checkpoint&apos;s page in a new tab.</dd>
              <dt>Copy code</dt>
              <dd>Copies the captured code block.</dd>
              <dt>Attach pasted code</dt>
              <dd>Saves pasted code as a linked note when capture missed it.</dd>
            </dl>
          </section>
          <section>
            <h4>Notes</h4>
            <dl>
              <dt>+ Note</dt>
              <dd>Starts a blank linked note.</dd>
              <dt>Note body</dt>
              <dd>Autosaves as you type; a conflict banner appears only if another panel saved first.</dd>
              <dt>Keep my draft / Use saved version</dt>
              <dd>Resolves a save conflict explicitly. Nothing is merged silently.</dd>
              <dt>Close tab / Delete note</dt>
              <dd>Closing hides the tab but keeps the note; deleting removes it for good.</dd>
            </dl>
          </section>
          <section>
            <h4>History &amp; account</h4>
            <dl>
              <dt>History rows</dt>
              <dd>Select a past checkpoint to resume it. Retry reruns a failed recap; Delete removes one or all.</dd>
              <dt>Export JSON</dt>
              <dd>Downloads checkpoints, notes, and history for backup.</dd>
              <dt>Sign in with Google</dt>
              <dd>Unlocks recaps. Signing out turns AI features off.</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
