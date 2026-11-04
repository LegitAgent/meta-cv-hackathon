import { useMemo, useState } from "react";
import type { ActivityEvent, Checkpoint, QualityCode, SummaryJob, SummaryStatus } from "../../shared/contracts";
import { diffCheckpoints } from "../../shared/diff";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type SortKey = "newest" | "oldest" | "title";

function summaryLabel(status: SummaryStatus | undefined): string {
  if (status === "pending") return "summary pending";
  if (status === "failed") return "summary failed";
  if (status === "complete") return "summarized";
  return "no summary";
}

export function HistoryView({
  checkpoints,
  summaries,
  events,
  selectedId,
  onSelect,
  onDelete,
  onDeleteMany,
  onRetry,
  aiEnabled,
  onOpenCheckpoint,
}: {
  checkpoints: Checkpoint[];
  summaries: Record<string, SummaryJob>;
  events: ActivityEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteMany?: (ids: string[]) => void | Promise<void>;
  onRetry: (id: string) => void;
  aiEnabled: boolean;
  onOpenCheckpoint?: (c: Checkpoint) => void;
}) {
  const [query, setQuery] = useState("");
  const [quality, setQuality] = useState<"all" | QualityCode>("all");
  const [summary, setSummary] = useState<"all" | SummaryStatus>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [checked, setChecked] = useState<string[]>([]);
  const [confirmOne, setConfirmOne] = useState<string | null>(null);
  const [confirmMany, setConfirmMany] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);

  // Chronological predecessor within the same task, regardless of sort/filter.
  const prevById = useMemo(() => {
    const byTask = new Map<string, Checkpoint[]>();
    for (const c of checkpoints) {
      const list = byTask.get(c.taskKey);
      if (list) list.push(c);
      else byTask.set(c.taskKey, [c]);
    }
    const prev = new Map<string, Checkpoint>();
    for (const list of byTask.values()) {
      list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      for (let i = 1; i < list.length; i++) prev.set(list[i].id, list[i - 1]);
    }
    return prev;
  }, [checkpoints]);

  const compareDiff = useMemo(() => {
    if (!compareId) return null;
    const cur = checkpoints.find((c) => c.id === compareId);
    const prev = cur ? prevById.get(cur.id) : undefined;
    if (!cur || !prev) return null;
    return { prev, diff: diffCheckpoints(prev, cur) };
  }, [compareId, checkpoints, prevById]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = checkpoints.filter((c) => {
      if (quality !== "all" && c.quality.code !== quality) return false;
      if (summary !== "all" && (summaries[c.id]?.status ?? "idle") !== summary) return false;
      if (q && !`${c.title} ${c.url}`.toLowerCase().includes(q)) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "oldest") return a.createdAt < b.createdAt ? -1 : 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    return out;
  }, [checkpoints, summaries, query, quality, summary, sort]);

  const checkedSet = useMemo(() => new Set(checked), [checked]);
  const visibleIds = useMemo(() => visible.map((c) => c.id), [visible]);
  const allVisibleChecked = visible.length > 0 && visible.every((c) => checkedSet.has(c.id));

  const toggle = (id: string, on: boolean) => {
    setChecked((prev) => (on ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  };

  const removeIds = (ids: string[]) => {
    setChecked((prev) => prev.filter((x) => !ids.includes(x)));
    if (ids.includes(confirmOne ?? "")) setConfirmOne(null);
  };

  const runDeleteOne = (id: string) => {
    onDelete(id);
    removeIds([id]);
    setConfirmOne(null);
  };

  const runDeleteMany = async (ids: string[]) => {
    if (onDeleteMany) await onDeleteMany(ids);
    else ids.forEach((id) => onDelete(id));
    removeIds(ids);
    setConfirmMany(false);
  };

  if (checkpoints.length === 0) return <div className="empty">No checkpoints yet.</div>;

  return (
    <div>
      <section className="card">
        <h3>Checkpoints</h3>
        <p className="hint">Switching browser tabs jumps to that tab's checkpoint. Tabs without one show a fresh save prompt, so capture a page first to include it.</p>
        <div className="history-toolbar">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title or URL"
            aria-label="Filter checkpoints"
          />
          <div className="history-filters">
            <label className="history-select">
              Quality{" "}
              <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} aria-label="Filter by quality">
                <option value="all">All</option>
                <option value="complete">complete</option>
                <option value="partial">partial</option>
                <option value="unavailable">unavailable</option>
              </select>
            </label>
            <label className="history-select">
              Summary{" "}
              <select value={summary} onChange={(e) => setSummary(e.target.value as typeof summary)} aria-label="Filter by summary status">
                <option value="all">All</option>
                <option value="idle">no summary</option>
                <option value="pending">pending</option>
                <option value="complete">summarized</option>
                <option value="failed">failed</option>
              </select>
            </label>
            <label className="history-select">
              Sort{" "}
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort checkpoints">
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="title">Title A–Z</option>
              </select>
            </label>
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="empty">
            No checkpoints match this filter.{" "}
            <button
              className="link"
              onClick={() => {
                setQuery("");
                setQuality("all");
                setSummary("all");
              }}
            >
              Clear filter
            </button>
          </div>
        ) : (
          <>
            <div className="row between">
              <span className="meta">
                {visible.length} of {checkpoints.length} shown
                {checked.length > 0 ? ` · ${checked.length} selected` : ""}
              </span>
              <span className="row">
                <button className="link" onClick={() => setChecked((prev) => Array.from(new Set([...prev, ...visibleIds])))}>
                  Select shown
                </button>
                <button className="link" onClick={() => setChecked([])} disabled={checked.length === 0}>
                  Clear
                </button>
              </span>
            </div>
            {checked.length > 0 && !confirmMany && (
              <div className="row">
                <button className="danger" onClick={() => setConfirmMany(true)}>
                  Trash selected ({checked.length})
                </button>
              </div>
            )}
            {confirmMany && (
              <div className="history-confirm" role="alert">
                <span>
                  Delete {checked.length} checkpoint{checked.length === 1 ? "" : "s"}
                  {checked.length - visibleIds.filter((id) => checkedSet.has(id)).length > 0
                    ? ` (${checked.length - visibleIds.filter((id) => checkedSet.has(id)).length} hidden by the current filter)` : ""}? Linked notes are kept.
                </span>
                <span className="row">
                  <button className="danger" onClick={() => void runDeleteMany(checked)}>
                    Delete
                  </button>
                  <button onClick={() => setConfirmMany(false)}>Keep</button>
                </span>
              </div>
            )}
            <ul className="history">
              {visible.map((c) => {
                const job = summaries[c.id];
                return (
                  <li key={c.id} className={c.id === selectedId ? "selected" : ""}>
                    <span className="history-top">
                      <input
                        type="checkbox"
                        checked={checkedSet.has(c.id)}
                        onChange={(e) => toggle(c.id, e.target.checked)}
                        aria-label={`Select ${c.title}`}
                      />
                      <button
                        className="link"
                        onClick={() => {
                          onSelect(c.id);
                          onOpenCheckpoint?.(c);
                        }}
                        title={`${c.title} — opens ${c.url}`}
                      >
                        {c.title}
                      </button>
                    </span>
                    <span className="meta">
                      {fmtTime(c.createdAt)} · {c.quality.code} · {summaryLabel(job?.status)}
                    </span>
                    {compareId === c.id && compareDiff && (
                      <div className="diff" role="note">
                        <div className="meta">
                          vs “{compareDiff.prev.title}”: {compareDiff.diff.summary}
                        </div>
                        {compareDiff.diff.changedLines.length > 0 && (
                          <ul className="diff-lines">
                            {compareDiff.diff.changedLines.map((l, i) => (
                              <li key={i} data-change={l.type}>
                                {l.type === "add" ? "+ " : "- "}
                                {l.text}
                              </li>
                            ))}
                          </ul>
                        )}
                        {compareDiff.diff.codeAdded + compareDiff.diff.codeRemoved >
                          compareDiff.diff.changedLines.length && (
                          <div className="meta">
                            Showing {compareDiff.diff.changedLines.length} of{" "}
                            {compareDiff.diff.codeAdded + compareDiff.diff.codeRemoved} changed lines.
                          </div>
                        )}
                      </div>
                    )}
                    {confirmOne === c.id ? (
                      <span className="history-confirm" role="alert">
                        <span>Delete “{c.title}”? Notes kept.</span>
                        <span className="row">
                          <button className="danger" onClick={() => runDeleteOne(c.id)}>
                            Delete
                          </button>
                          <button onClick={() => setConfirmOne(null)}>Keep</button>
                        </span>
                      </span>
                    ) : (
                      <span className="row">
                        {prevById.has(c.id) && (
                          <button
                            className="link"
                            onClick={() => setCompareId(compareId === c.id ? null : c.id)}
                          >
                            {compareId === c.id ? "Hide diff" : "Compare with previous"}
                          </button>
                        )}
                        {job?.status === "failed" && (
                          <>
                            <button className="link" onClick={() => onRetry(c.id)} disabled={!aiEnabled} title={!aiEnabled ? "Enable AI in Resume to retry" : undefined}>
                              Retry
                            </button>
                            {!aiEnabled && <span className="hint">Enable AI in Resume to retry.</span>}
                          </>
                        )}
                        <button className="link danger" onClick={() => setConfirmOne(c.id)}>
                          Trash
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <label className="row history-all">
              <input
                type="checkbox"
                checked={allVisibleChecked}
                onChange={(e) => setChecked(e.target.checked ? visibleIds : [])}
              />
              <span className="meta">Select all shown</span>
            </label>
          </>
        )}
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
