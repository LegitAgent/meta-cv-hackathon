import { useState } from "react";
import type { Checkpoint, SummaryJob } from "../../shared/contracts";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function QualityBadge({ checkpoint }: { checkpoint: Checkpoint }) {
  const q = checkpoint.quality;
  return (
    <div className="quality" data-quality={q.code}>
      <span className="quality-code">{q.code}</span>
      {q.missingFields.length > 0 && <span>Missing: {q.missingFields.join(", ")}</span>}
      {q.truncatedFields.length > 0 && <span>Truncated: {q.truncatedFields.join(", ")}</span>}
      {q.warnings.map((w) => (
        <span key={w} className="warning">
          {w}
        </span>
      ))}
    </div>
  );
}

export function ResumeView({
  checkpoint,
  job,
  onSummarize,
  onCopyCode,
  onOpenSource,
  busy,
  aiEnabled,
  onAiEnabled,
  autoSummarize,
  onAutoSummarize,
  onPasteCode,
}: {
  checkpoint: Checkpoint | null;
  job: SummaryJob | null;
  onSummarize: () => void;
  onCopyCode: () => void;
  onOpenSource: () => void;
  busy: boolean;
  aiEnabled: boolean;
  onAiEnabled: (v: boolean) => void;
  autoSummarize: boolean;
  onAutoSummarize: (v: boolean) => void;
  onPasteCode: (code: string) => void;
}) {
  const [paste, setPaste] = useState("");
  if (!checkpoint) return <div className="empty">No checkpoint yet. Click the toolbar button (“Pause here”) on any page.</div>;
  return (
    <section className="card">
      <h2>{checkpoint.title}</h2>
      <div className="meta">
        <span>{fmtTime(checkpoint.createdAt)}</span>
        <span>{checkpoint.adapter}</span>
      </div>
      <QualityBadge checkpoint={checkpoint} />
      <div className="row">
        <button onClick={onOpenSource}>Reopen source</button>
        {checkpoint.code && <button onClick={onCopyCode}>Copy code</button>}
      </div>
      {checkpoint.code && (
        <pre className="code">{checkpoint.code.slice(0, 4000)}</pre>
      )}
      {!checkpoint.code && (
        <details className="paste-box">
          <summary>Code wasn’t captured? Paste it here</summary>
          <textarea
            rows={6}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste your current code…"
          />
          <div className="row">
            <button
              onClick={() => {
                onPasteCode(paste);
                setPaste("");
              }}
              disabled={!paste.trim()}
            >
              Attach pasted code
            </button>
          </div>
          <p className="hint">
            Saved as a note linked to this checkpoint, auto-selected for the next recap. Notes share a
            10,000-character recap budget; longer text is trimmed and the trim is labeled above.
          </p>
        </details>
      )}
      <div className="consent">
        <label>
          <input type="checkbox" checked={aiEnabled} onChange={(e) => onAiEnabled(e.target.checked)} /> I understand the
          selected checkpoint leaves the device for summarization.
        </label>
        <label>
          <input
            type="checkbox"
            checked={autoSummarize}
            disabled={!aiEnabled}
            onChange={(e) => onAutoSummarize(e.target.checked)}
          />{" "}
          Summarize new captures automatically.
        </label>
      </div>
      <div className="row">
        <button onClick={onSummarize} disabled={busy || !aiEnabled}>
          {busy ? "Summarizing…" : job?.status === "pending" ? "Retry summary" : "Generate recap"}
        </button>
      </div>
      {job && job.warnings.length > 0 && (
        <div className="warning">
          {job.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
      {job?.status === "failed" && job.error && <div className="error">Summary failed ({job.error.code}): {job.error.message}</div>}
    </section>
  );
}

export function SummaryCard({ job }: { job: SummaryJob | null }) {
  const [showFacts, setShowFacts] = useState(false);
  if (!job?.result) return null;
  const s = job.result;
  return (
    <section className="card summary">
      <h3>Recap</h3>
      <p>{s.recap}</p>
      <button className="link" onClick={() => setShowFacts((v) => !v)}>
        {showFacts ? "Hide observed facts" : `Show observed facts (${s.observedFacts.length})`}
      </button>
      {showFacts && (
        <ul>
          {s.observedFacts.map((f, i) => (
            <li key={i}>
              {f.text} <span className="src">[{f.sourceFields.join(", ")}]</span>
            </li>
          ))}
        </ul>
      )}
      {s.possibleBlocker && (
        <p className="blocker">
          <strong>Possible blocker (inferred):</strong> {s.possibleBlocker}
        </p>
      )}
      <p>
        <strong>Next action:</strong> {s.nextAction}
      </p>
      {s.uncertainties.length > 0 && (
        <div className="uncertain">
          <strong>Uncertainties:</strong>
          <ul>
            {s.uncertainties.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
