import { useEffect, useState } from "react";
import type { Checkpoint, SummaryJob } from "../../shared/contracts";

function RetryCountdown({ readyAt }: { readyAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (readyAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [readyAt]);
  const left = Math.max(0, Math.ceil((readyAt - now) / 1000));
  return <span>{left > 0 ? `Retry available in ${left}s.` : "You can retry now."}</span>;
}

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
  autoSummarize,
  onAutoSummarize,
  onPasteCode,
  pasteError,
}: {
  checkpoint: Checkpoint | null;
  job: SummaryJob | null;
  onSummarize: () => void;
  onCopyCode: () => void;
  onOpenSource: () => void;
  busy: boolean;
  autoSummarize: boolean;
  onAutoSummarize: (v: boolean) => void;
  onPasteCode: (code: string) => Promise<boolean>;
  pasteError: string | null;
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
      {(!checkpoint.code || checkpoint.quality.code === "partial") && (
        <details className="paste-box">
          <summary>{checkpoint.code ? "Captured code is partial? Paste the full code" : "Code wasn’t captured? Paste it here"}</summary>
          <textarea
            rows={6}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste your current code…"
          />
          <div className="row">
            <button
              onClick={() => void onPasteCode(paste).then((saved) => { if (saved) setPaste(""); })}
              disabled={!paste.trim()}
            >
              Attach pasted code
            </button>
          </div>
          {pasteError && <div className="error" role="alert">{pasteError}</div>}
          <p className="hint">
            Saved as a note linked to this checkpoint (maximum 50,000 characters). For the next recap, pasted code
            replaces the captured code; content beyond 30,000 characters is trimmed with a warning. The saved checkpoint stays unchanged.
          </p>
        </details>
      )}
      <div className="consent">
        <label>
          <input
            type="checkbox"
            checked={autoSummarize}
            onChange={(e) => onAutoSummarize(e.target.checked)}
          />{" "}
          Summarize new captures automatically.
        </label>
      </div>
      <div className="row">
        <button className="primary" onClick={onSummarize} disabled={busy}>
          {busy ? "Summarizing…" : job?.status === "pending" ? "Retry summary" : "Generate recap"}
        </button>
      </div>
      {job && job.warnings.length > 0 && (
        <div className="warning">
          {job.warnings.map((w, i) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      {job?.status === "failed" && job.error && (
        <div className="error">
          Summary failed ({job.error.code}): {job.error.message}{" "}
          {job.error.code === "RATE_LIMITED" &&
            typeof job.error.retryAfterSeconds === "number" &&
            job.startedAt && !Number.isNaN(Date.parse(job.startedAt)) && (
              <RetryCountdown readyAt={Date.parse(job.startedAt) + job.error.retryAfterSeconds * 1000} />
            )}
        </div>
      )}
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
      <button
        className="link"
        onClick={() =>
          void navigator.clipboard
            .writeText(
              [
                s.recap,
                `Next action: ${s.nextAction}`,
                s.possibleBlocker ? `Possible blocker: ${s.possibleBlocker}` : null,
              ]
                .filter((line): line is string => line !== null)
                .join("\n\n"),
            )
            .catch(() => undefined)
        }
      >
        Copy recap
      </button>
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
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
