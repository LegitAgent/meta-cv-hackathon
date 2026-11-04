# Backtrack — Next Features (1 + 2 + 3)

Status: planned for current batch. Source of truth for Resume stack, Attempt diff, Stuck-point tag.
Follows `SPEC.md` (local-first, immutable checkpoints) and `MUSE_REVIEW.md` (read before each batch).

## 1. Resume stack — "Back to where I was"

Goal: one click actually resumes, not just views.

- ResumeView gets a `Resume stack` section for the selected checkpoint:
  - `Reopen source` button (already exists) + `Copy code` (already exists) + new `Copy recap` already exists in SummaryCard.
  - New: `Open last 3 from this task` — lists up to 3 newest checkpoints with the same `taskKey`, each with Reopen.
  - New: `checkpoint.resumed` activity event on reopen (already in `ActivityType`).
- Acceptance:
  - Clicking Reopen opens `checkpoint.url` in a new tab.
  - No overwrite of live editor; code stays a snapshot.
  - Works with `chrome.tabs.create`, falls back to copy-URL when tabs API unavailable.

## 2. Attempt diff — "what did I try last time?"

Goal: show what changed between attempts on the same task.

- New helper `diffCheckpoints(a, b)` in `extension/src/shared/`:
  - Compares `code` line-by-line (simple LCS / prefix-suffix), compares `pageText` length + `title`.
  - Returns `{ codeAdded, codeRemoved, sameTask, summary }`.
- HistoryView / ResumeView:
  - When 2+ checkpoints share `taskKey`, show `Compare with previous` toggle.
  - Render added/removed line counts + first ~40 changed lines, no AI needed.
- Acceptance:
  - Same-task check uses `taskKey`, not URL substring.
  - Empty code on either side shows "no code in one snapshot" instead of empty diff.
  - Unit test with two small code snapshots.

## 3. Stuck-point tag — "where were you stuck?"

Goal: one optional line at save time that focuses the recap.

- Capture flow:
  - New optional `stuckPoint: string | null` on `Checkpoint` (max 500 chars).
  - Panel capture box: optional input "Where are you stuck? (optional)" next to Save button.
  - `CAPTURE` worker command accepts `stuckPoint`; repository stores it immutably.
- Recap flow:
  - `SummaryRequestPayload.checkpoint` includes `stuckPoint`.
  - Backend prompt appends: `User stuck point: <text>` when present.
  - Recap UI shows the stuck point under the title when present.
- Acceptance:
  - Empty = null, never blocks save.
  - Old checkpoints without the field still load (optional field, migration-free).
  - Payload test: stuck point included, truncation flagged.

## How to work piecemeal (for other bots)

- Pick ONE task (A, B, or C) per change. Do not mix files across tasks.
- Read `MUSE_REVIEW.md` before each batch. Keep MV3 narrow permissions (`activeTab`, `scripting`, `storage`, `sidePanel` only).
- Checkpoints stay immutable. `chrome.storage.local` only. Backend URL fixed to `https://backtrack.martinalba.dev`.
- Verify with `npx tsc --noEmit` in `extension/` + new/updated test in `extension/tests/`. Note if `vite build` is sandbox-blocked and `dist/` needs a dev-machine rebuild.
- Update the status table below in the same commit as the code.

| Task | Files | Status |
| ---- | ----- | ------ |
| A. Resume stack | `extension/src/panel/components/ResumeView.tsx`, `extension/src/panel/App.tsx`, `extension/src/storage/repository.ts` (resume event) | in review — code + `resume-stack.test.tsx` added, `tsc` clean, vitest blocked by sandbox |
| B. Attempt diff | new `extension/src/shared/diff.ts`, `extension/src/panel/components/HistoryView.tsx`, `extension/tests/diff.test.ts` | done — HistoryView toggle + 6 unit tests, 111/111 suite green; ResumeView toggle deferred to Task A to avoid editing the same file |
| C. Stuck-point tag | `extension/src/shared/contracts.ts`, `extension/src/storage/repository.ts`, `extension/src/background.ts`, `extension/src/panel/components/ResumeView.tsx`, `backend/worker/src/index.ts` | done — capture input + trim/flag at 500 chars, persisted + shown under title, appended to provider text; 114/114 extension + 42/42 worker tests green |

Suggested order: C → A → B. C changes the contract, A is UI-only, B is standalone.

## Non-goals (this batch)

- No auto distraction detection, no `browsing-history` permission.
- No site blocking, scoring, cloud sync, multi-provider failover.
- No checkpoint mutation — Save again always creates new.
