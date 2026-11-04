import type { ActivityEvent, Checkpoint, SummaryJob } from "../../shared/contracts";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function HistoryView({
  checkpoints,
  summaries,
  events,
  selectedId,
  onSelect,
  onDelete,
  onRetry,
  aiEnabled,
}: {
  checkpoints: Checkpoint[];
  summaries: Record<string, SummaryJob>;
  events: ActivityEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  aiEnabled: boolean;
}) {
  if (checkpoints.length === 0) return <div className="empty">No checkpoints yet.</div>;
  return (
    <div>
      <section className="card">
        <h3>Checkpoints</h3>
        <p className="hint">Switching browser tabs jumps to that tab's checkpoint. Capture a page first to include it.</p>
        <ul className="history">
          {checkpoints.map((c) => {
            const job = summaries[c.id];
            return (
              <li key={c.id} className={c.id === selectedId ? "selected" : ""}>
                <button className="link" onClick={() => onSelect(c.id)}>
                  {c.title}
                </button>
                <span className="meta">
                  {fmtTime(c.createdAt)} · {c.quality.code}
                  {job?.status === "pending" ? " · summary pending" : ""}
                  {job?.status === "failed" ? " · summary failed" : ""}
                  {job?.status === "complete" ? " · summarized" : ""}
                </span>
                <span className="row">
                  {job?.status === "failed" && (
                    <button className="link" onClick={() => onRetry(c.id)} disabled={!aiEnabled} title={!aiEnabled ? "Enable AI in Resume to retry" : undefined}>
                      Retry
                    </button>
                  )}
                  <button
                    className="link danger"
                    onClick={() => {
                      if (window.confirm(`Delete checkpoint “${c.title}”? Linked notes are kept.`)) onDelete(c.id);
                    }}
                  >
                    Delete
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="card">
        <h3>Activity</h3>
        {events.length === 0 ? (
          <div className="empty">No activity yet.</div>
        ) : (
          <ul className="history">
            {events.slice(0, 30).map((e) => (
              <li key={e.id}>
                <span>{e.type}</span>
                <span className="meta">
                  {fmtTime(e.timestamp)}
                  {e.status ? ` · ${e.status}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
