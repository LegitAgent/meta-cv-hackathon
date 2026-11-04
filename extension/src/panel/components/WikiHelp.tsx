import { useEffect } from "react";

// Mini wiki popup. Add future doc sections inside `.wiki-body`
// as new <section> blocks. Keep each table narrow.
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
        aria-label="Mini wiki"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between">
          <h3>Mini wiki</h3>
          <button onClick={onClose} aria-label="Close wiki">
            Close
          </button>
        </div>
        <div className="wiki-body">
          <section>
            <h4>Capture quality</h4>
            <table className="wiki-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Means</th>
                  <th>Trigger</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>complete</td>
                  <td>All fields kept</td>
                  <td>No gaps</td>
                </tr>
                <tr>
                  <td>partial</td>
                  <td>Usable, gaps</td>
                  <td>Missing / cut / warning</td>
                </tr>
                <tr>
                  <td>unavailable</td>
                  <td>Nothing usable</td>
                  <td>No text or code</td>
                </tr>
              </tbody>
            </table>
          </section>
          {/* Add future wiki sections here. */}
        </div>
      </div>
    </div>
  );
}
