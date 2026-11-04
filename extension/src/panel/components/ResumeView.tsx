import { useEffect, useRef, useState } from "react";
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

/** Newest same-task checkpoints excluding the selected one. */
export function getResumeStack(all: Checkpoint[], selected: Checkpoint | null, limit = 3): Checkpoint[] {
  if (!selected) return [];
  return all
    .filter((c) => c.id !== selected.id && c.taskKey === selected.taskKey)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export function ResumeView({
  checkpoint,
  job,
  related,
  onCapture,
  capturing,
  onSummarize,
  onCopyCode,
  onOpenSource,
  onOpenCheckpoint,
  busy,
  autoSummarize,
  onAutoSummarize,
  onPasteCode,
  pasteError,
}: {
  checkpoint: Checkpoint | null;
  job: SummaryJob | null;
  related: Checkpoint[];
  onCapture: () => void;
  capturing: boolean;
  onSummarize: () => void;
  onCopyCode: () => void;
  onOpenSource: () => void;
  onOpenCheckpoint: (c: Checkpoint) => void;
  busy: boolean;
  autoSummarize: boolean;
  onAutoSummarize: (v: boolean) => void;
  onPasteCode: (code: string) => Promise<boolean>;
  pasteError: string | null;
}) {
  const [paste, setPaste] = useState("");
  if (!checkpoint)
    return (
      <section className="card">
        <button className="primary large" onClick={onCapture} disabled={capturing}>
          {capturing ? "Saving…" : "Save this page"}
        </button>
        <p className="hint">No checkpoint yet. Save the current tab to start a recap.</p>
      </section>
    );
  return (
    <section className="card">
      <div className="row between">
        <span className="saved-pill" title={fmtTime(checkpoint.createdAt)}>Saved ✓</span>
        <button onClick={onCapture} disabled={capturing}>
          {capturing ? "Saving…" : "Save again"}
        </button>
      </div>
      <h2>{checkpoint.title}</h2>
      <div className="meta">
        <span>{fmtTime(checkpoint.createdAt)}</span>
        <span>{checkpoint.adapter}</span>
      </div>
      <QualityBadge checkpoint={checkpoint} />
      {checkpoint.screenshot && (
        <img
          src={checkpoint.screenshot}
          alt="Screenshot of the captured page"
          style={{ maxWidth: "100%", borderRadius: 8 }}
        />
      )}
      <div className="row">
        <button onClick={onOpenSource}>Reopen source</button>
        {checkpoint.code && <button onClick={onCopyCode}>Copy code</button>}
      </div>
      {related.length > 0 && (
        <div className="resume-stack">
          <h3>Back to where I was</h3>
          <p className="hint">Other saves from this same task. Reopening never changes saved code.</p>
          <ul>
            {related.map((c) => (
              <li key={c.id}>
                <button className="link" onClick={() => onOpenCheckpoint(c)} title={c.url}>
                  {c.title}
                </button>
                <span className="meta"> · {fmtTime(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
      <p className="hint">
        Saving captures a compressed screenshot of the visible tab alongside the page text. It is sent
        with the recap request only — avoid saving pages that show passwords or other sensitive content.
      </p>
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
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);
  if (!job?.result) return null;
  const s = job.result;
  function copyRecap() {
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
      .then(() => {
        setCopied(true);
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => undefined);
  }
  return (
    <section className="card summary">
      <h3>Recap</h3>
      <p>{s.recap}</p>
      <button
        className={`icon-button${copied ? " copied" : ""}`}
        onClick={copyRecap}
        aria-label={copied ? "Copied" : "Copy recap"}
        title={copied ? "Copied!" : "Copy recap"}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="5" y="5" width="9" height="9" rx="2" />
          <path d="M11 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1" />
        </svg>
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
