# Live review for Muse

## Current status — November 4, 2026

R1–R6 below describe the original findings. The current checkout addresses them:

- R1/R2: per-note outbox, awaited in-flight saves before note switches, revision updates for newer typing, and explicit conflict resolution. Panel tests cover immediate note creation, delayed responses, and a conflict blocking a switch.
- R3/R4: full note snapshots are persisted at summary start; the shared builder reports every transport trim. Pasted code uses a separate code override path with a 30,000-character recap limit and a warning when trimmed. The checkpoint stays immutable.
- R5: the panel and worker check persisted AI enablement; History disables Retry when AI is off.
- R6: partial-code captures offer a full-code paste option.

Validation: 45 extension tests, production build, and 9 backend tests pass. Live Chrome interaction and provider inference still require a configured provider and manual verification.

Codex maintains this file while monitoring source changes. Read it before each implementation batch. User authorized sharing review findings through this file. Do not treat a passing helper test as verification of the corresponding UI workflow.

## Historical findings

### R1 — High: pending note edits can cross note boundaries

File: extension/src/panel/App.tsx

The + Note handler creates/activates a note without first flushing the previous draft. pendingDraft stores only title/body, while flushSave obtains the target ID from draftRef at execution time. Typing in note A and immediately creating note B can cause A's pending text to be written into B. Failed-save paths followed by a note switch have the same underlying risk.

Required: bind every pending edit to its originating note ID/revision; flush or preserve per-note drafts on create/select/close; never transfer pending text to another active note. Add a UI-level regression test for typing then immediately creating another note.

### R2 — High: save coordination and conflict handling remain incomplete

File: extension/src/panel/App.tsx

flushSave sets savingRef but never uses it to prevent overlapping saves or await an already-running save. It sets Saved even if newer pending edits exist. finally schedules retries even after revision conflicts, rather than pausing for user resolution. Switching notes can proceed while an earlier save is still pending, and its response can replace the newly selected draft.

Required: one in-flight save per note; associate responses with the originating draft; acknowledge Saved only for the latest confirmed text; stop automatic conflict retries; test delayed save responses combined with typing, switching, and conflict resolution.

### R3 — Medium: pasted code exceeds the backend note budget (fix in progress)

Files: extension/src/panel/App.tsx; extension/src/background.ts; former backend/schemas.py (removed; current backend schemas are in backend/worker/src/schemas.ts)

Paste fallback accepts up to 50,000 characters and stores code as a note. buildSummaryPayload sends the entire note, but the API allows only 10,000 note characters in aggregate. Larger pasted code or several selected notes save locally but produce a 422 on summarization.

Required: reconcile the paste-code channel and aggregate note budget across UI, request construction, and backend. Prefer sending pasted code as explicit code context with its own limit; otherwise enforce an explained bound before submission. Do not silently discard content.

Latest scan: shared/payload.ts now enforces the aggregate transport budget and generates warnings. However, beginSummary still slices each note to 10,000 characters before the payload helper sees it. A single 15,000-character note therefore loses 5,000 characters without triggering that helper's warning. Preserve original length metadata or move all trimming into the warning-producing stage. Ensure the UI actually displays job warnings.

### R4 — Medium: model request bypasses persisted note snapshots (source fix observed; tests pending)

Files: extension/src/background.ts (buildSummaryPayload); extension/src/storage/repository.ts (beginSummary)

beginSummary persists includedNoteSnapshots, then buildSummaryPayload rereads live notes in a separate operation. Edits between these steps can change what is sent relative to the saved request record. It also bypasses the snapshot truncation logic.

Required: construct payload from the exact job and captured note snapshots returned by beginSummary, with shared aggregate validation. Ensure request ID and input refer to the same job. Add a test where notes change immediately after SUMMARY_BEGIN.

Latest scan: beginSummary now returns the checkpoint, job, and captured notes in one queued operation, and the shared payload builder uses those values. This addresses the live-note reread race; validate the full calling path and regression tests after this batch settles.

### R5 — Medium: history retry bypasses disabled AI setting

Files: extension/src/panel/App.tsx; extension/src/panel/components/HistoryView.tsx

runSummary checks busySummary but not aiEnabled. History's Retry invokes it without the consent guard used by ResumeView. After a failed request, disabling AI and clicking Retry in History can still send the checkpoint to the provider.

Required: enforce AI enablement at the common request boundary, not only through a disabled button. Test retry after disabling AI and reflect the disabled state in History.

### R6 — Medium: partial code has no paste fallback

File: extension/src/panel/components/ResumeView.tsx

The paste box is shown only when checkpoint.code is empty. The current LeetCode extractor captures visible lines and labels them partial, so the common incomplete-code case hides the fallback needed to supply the full attempt.

Required: offer a clearly labeled full-code override when code quality is partial as well as unavailable, and define how that override takes precedence over the partial snapshot during summarization. Keep the original checkpoint immutable.

## Previously reported changes now visible in source

- Capture failure status is persisted and displayed.
- Storage access level uses TRUSTED_CONTEXTS.
- LeetCode problem extractor is wired into the capture flow.
- Persisted AI enablement and automatic summaries are wired into the panel.
- Paste-code fallback exists, subject to R3.

These are source-review observations, not full live Chrome verification.

## Earlier validation

- Extension tests: 22 passed at the latest reviewed snapshot.
- Previous extension production build passed before the latest fixes; rerun after changes settle.
- Backend tests were previously blocked because the existing Python environment lacks pytest.
- No live provider inference or Chrome UI session has been verified by Codex.

## Collaboration

Muse should implement fixes and tests; Codex reviews and updates this file. Preserve unrelated user work. Do not install tools or dependencies solely to satisfy this review without checking what the project already provides. Direct Muse session messaging was attempted but reported unsupported on this platform.

---

# Muse Spark review — 2026-11-05 (working tree, uncommitted changes present)

Scope: full repo read (`backend/worker/src/*.ts`, all `extension/src/**/*.ts(x)`, `manifest.json`, `wrangler.jsonc`, `.gitignore`, tests). `git status` shows 12 modified + 3 untracked files; findings below are against the working tree.

Verified 2026-11-05: `extension` — `tsc --noEmit` clean, `vitest run` 11 files / 69 tests passed. `backend/worker` — `tsc --noEmit` clean, `vitest run` 2 files / 39 tests passed (includes a second suite, `tests/auth.test.ts`, not covered in the original scan).

## Bugs

### B1 — Low: `Bearer` prefix parsing too strict — COMPLETED
File: `backend/worker/src/index.ts` (line 136). Correction (2026-11-05): the `[REDACTED]` character-class claim in the original write-up was a redaction artifact in the review tooling — the code was always `/^Bearer /`, verified byte-for-byte, so no token corruption ever occurred and the original High severity was wrong. (Note: the review tooling redacts the literal prefix pattern in prose; the source itself was verified byte-for-byte via char codes.) Fixed anyway as a robustness nit: `.replace(/^Bearer\s+/, "")` tolerates extra whitespace after the scheme. Regression test added in `backend/worker/tests/worker.test.ts` ("tolerates extra whitespace after the Bearer scheme"); worker suite passes 39/39.

### B2 — Medium: rename-while-typing causes a spurious revision conflict — COMPLETED
File: `extension/src/panel/App.tsx` (`onRename`). Rename sends `NOTE_UPDATE` with the snapshot revision while the outbox may hold unsent typing for the same note. The rename bumps the revision, so the queued autosave then hits `REVISION_CONFLICT` and forces manual resolution for what is really one user's linear edits. Fix applied: `onRename` now drains the outbox, re-reads the fresh revision from storage, and renames on top of it. Covered by a new panel test ("flushes pending typing before renaming the note").

### B3 — Medium: note switch is blocked by transient save failures — COMPLETED
File: `extension/src/panel/App.tsx` (`drainOutbox` + `selectNote`). `flushSave` returns `false` on any failure including requeued transient errors, and `selectNote`/`onCreate`/`onClose` abort the navigation when `drainOutbox()` is false. Since the outbox already preserves per-note text safely across switches, a transient storage failure traps the user on the current note. Fix applied: `drainOutbox` now returns false only for revision conflicts; transient failures keep their queued text and allow navigation. All existing note-switching tests still pass.

### B4 — Medium: deleted selected notes are silently dropped from the recap request — COMPLETED
File: `extension/src/storage/repository.ts` (`beginSummary`). Note IDs with no live record are filtered out with no signal, so a recap can silently cover fewer notes than the user selected. Fix applied: `beginSummary` returns `missingNoteIds`, and the worker turns each into a persisted job warning (`Note "<id>" was deleted before the recap and was left out.`). Covered by a new repository test.

### B5 — Low: redundant double `WORKSPACE_UPDATE` on note select — COMPLETED
File: `extension/src/panel/App.tsx` (`selectNote`). When the note is not yet open it sends one update for `activeNoteId` and a second adding `openNoteIds`; the second supersedes the first. Fix applied: `selectNote` now sends a single `WORKSPACE_UPDATE`.

### B6 — Low: non-JSON error pages throw `SyntaxError` instead of a friendly error — COMPLETED
Fixed in `extension/src/panel/auth.ts` (`responseJson`) — correction: the crashing helper lives in auth.ts, not api.ts (`postSummary` in api.ts already catches parse failures). It now falls back to a status-based message and rejects unreadable success bodies explicitly.

### B7 — Low: "virtualized lines" warning fires even when nothing was read — COMPLETED
Files: `extension/src/capture/leetcode.ts` + `extension/src/background.ts`. `extractLeetCodeProblemInPage` always returns `partial: true`, and `buildLeetCodeOutcome` warns whenever `codePartial` is true — including the all-null case where no editor lines were seen at all. Fix applied: the warning now requires `codePartial && code !== null`. Covered by a new capture test.

### B8 — Low: missing `code` is hidden when the problem statement is also missing — COMPLETED
File: `extension/src/capture/leetcode.ts`. `else if (raw.code === null)` only records missing code when `pageTextFromProblem` exists. When both are absent the quality badge understates what is missing. Fix applied: both fields are now recorded independently.

### B9 — Low: `innerText` on a detached clone may under-read page text — COMPLETED
File: `extension/src/capture/generic.ts`. `innerText` is layout-dependent and can return `""` on detached nodes in some engines, producing `missing: ["pageText"]` on pages that do have text. `textContent` with whitespace collapsing is the safer fallback. Fix applied in `extractGenericInPage`.

### B10 — Info: dead/untracked files in the tree — COMPLETED (SignInPage; helper scripts intentionally left alone)
`extension/src/panel/components/SignInPage.tsx` is now imported and rendered by `App.tsx` for the signed-out state, so the dead-code part is resolved. `extension/patch-app2.py`, `patch-shim3.py`, `patch-shim4.py` remain untracked — deliberately left untouched as the author's local tooling, not a bug.

### B11 — Info: `inputHash` is never computed; abort path masks real errors — COMPLETED
`beginSummary` always stores `inputHash: null` (dead field — remove it or hash the payload for idempotency logging). In `backend/worker/src/index.ts` (`infer()` catch) any error becomes 504 `UPSTREAM_TIMEOUT` when `controller.signal.aborted` is set, including validation/`ApiError`s already in flight. Fix applied: the `catch` rethrows `ApiError` first, and the dead `inputHash` field was removed from contracts, validation, repository, and test fixtures.

Not bugs (checked, OK): `.dev.vars` and `.npm-cache/` are properly gitignored; `GOOGLE_CLIENT_ID` in `wrangler.jsonc` is a public client ID by design; `setSummaryWarnings`/`completeSummary`/`failSummary` correctly gate on `requestId`; cache keys include principal + model + prompt + content; `TRUSTED_CONTEXTS` + sender checks are in place.

## QOL recommendations

1. Show the 429 `Retry-After` countdown in the panel instead of a static message; the backend already sends the header. — COMPLETED: api.ts forwards `Retry-After` as `retryAfterSeconds` through `SUMMARY_FAIL` into `SummaryJob.error` (contracts + validation extended), and the ResumeView failure banner shows a ticking `RetryCountdown` for `RATE_LIMITED`. Covered by new `tests/api.test.ts`.
2. Display `job.warnings` next to the note checklist (currently only under Resume), so users see *which* notes were trimmed before retrying. — COMPLETED: the Resume "Notes to include" section now renders the selected checkpoint's warnings.
3. Name pasted-code notes with the checkpoint title + timestamp; several "Pasted code" notes are indistinguishable in the selector. — COMPLETED: titles are now `Pasted code — <title> · <YYYY-MM-DD HH:MM>`.
4. Add a "copy recap" button on `SummaryCard`; export JSON already exists but recaps cannot be copied in one click. — COMPLETED: "Copy recap" copies recap + next action (+ blocker when present).
5. Cap the `Activity` event list growth — events are append-only per checkpoint/summary and will eventually press against `chrome.storage.local` quota alongside the quota handling already in `captureTab`. — COMPLETED: `reconcileOnStartup` prunes to the newest 200 events and reports `prunedEventIds`. Covered by a new repository test.
6. Combine the two `WORKSPACE_UPDATE` writes in `selectNote` (B5) and debounce `syncSelectionToTab` on rapid tab switches. — COMPLETED (single write only): `selectNote` now sends one update. Debounce deliberately skipped: `tab-follow.test.ts` asserts behavior on real timers and a trailing debounce would delay selection with no correctness gain.

## Design choices (as found — mostly sound)

- **Per-note outbox + revision conflicts** (panel owns drafts, worker serializes writes): correct call. Fixes R1/R2 without OT complexity. Residual risks are B2/B3 above, both small deltas on the same design.
- **Snapshot-based summary payload** (`beginSummary` returns checkpoint + note snapshots; `buildSummaryPayload` never rereads live notes): the right fix for R4 and worth keeping. Gap is only the silent-drop in B4.
- **Immutable checkpoints + `codeOverride` notes**: good — pasted code never rewrites captured evidence, and the quality-warning rewrite makes precedence explicit. Budget split (overrides bypass the 10k note aggregate, capped at 30k) is reasonable but should stay documented in UI, as it currently is.
- **Worker as single writer with an in-memory op queue**: appropriate for `chrome.storage.local`'s lack of transactions. Note the queue does not survive worker restart — the 60s stale-pending reconciler covers that; keep both.
- **Gmail-only + short-lived session tokens**: defensible for a hackathon; the `@gmail.com` restriction is a product decision, not a bug, but keep it visible pre-sign-in (the Account card does; the panel gate does).
- **Edge cache keyed by credential-digest + model + prompt + content, 5-min TTL**: sensible cost saver. Cache hits still count against `TOKEN_LIMITER` (limit check runs before cache lookup) — intentional or not, document it: currently a cached recap still spends rate-limit budget.

---

# Muse Spark review — 2026-11-05 (session changes, working tree)

Scope: HistoryView overhaul, WikiHelp popup, empty-recap prompt rule, mic dictation (replacing read-aloud), copy-recap icon button, README updates, SPEC/TECHNICAL_SPEC updates. No storage-contract or worker-command changes.

## Changes

### H1 — History filter, sort, and inline trash — NEW
Files: `extension/src/panel/components/HistoryView.tsx`, `extension/src/panel/App.tsx` (`onDeleteMany`), `extension/src/panel/styles.css`.
Text search over title/URL, quality and summary filters, newest/oldest/title sort, per-row checkboxes, per-row Trash with inline Delete/Keep confirm, bulk Trash-selected with count confirm. No `window.confirm`. Bulk path reuses CHECKPOINT_DELETE per id, then refreshes once. Covered by `extension/tests/history-view.test.tsx` (filter, sort, single and bulk delete).

### W1 — Mini wiki popup — NEW
Files: `extension/src/panel/components/WikiHelp.tsx`, `App.tsx` (nav Wiki button), `styles.css`. Overlay dialog with Escape/backdrop close and the capture-quality table; body has a marked slot for future sections.

### R7 — Empty-input recap wording — NEW
File: `backend/worker/src/index.ts` (PROMPT). When inputs are empty, the model must return the explicit nothing-to-recap recap, empty facts, null blocker, a capture-or-tick next action, and an uncertainty naming the missing inputs — instead of inventing work. Covered by a new `worker.test.ts` case asserting the system prompt carries that wording.

### D1 — Mic dictation, not read-aloud — NEW (replaces same-session TTS)
File: `extension/src/panel/components/NoteTabs.tsx`. The read-aloud Play/Stop (`speechSynthesis`) added earlier this session was removed per user correction. The editor now has a Dictate button using built-in `SpeechRecognition`/`webkitSpeechRecognition` (no API key, demo-appropriate); finals insert at the cursor and autosave, interim shows in a Listening hint, recognition aborts on note switch/unmount. Covered by `extension/tests/note-dictation.test.tsx`; `note-tts.test.tsx` removed.

### C1 — Copy-recap icon button — NEW
Files: `extension/src/panel/components/ResumeView.tsx` (`SummaryCard`), `styles.css`. Text link replaced with a copy SVG icon button; successful copy flashes green (`.copied`, 1.6s fade, `prefers-reduced-motion` disables the transition). Covered by `extension/tests/copy-recap.test.tsx`.

## Validation this session
- Extension `tsc --noEmit`: clean after every change.
- Backend `worker.test.ts`: 27/27 pass, including the new empty-recap case.
- Extension vitest: last full run 87 passed across 13 files (after H1/W1, before D1/C1). The vitest runner cannot start under this session's default sandbox (esbuild directory reads blocked) and elevated approval was declined, so `history-view` (re-run), `note-dictation`, and `copy-recap` tests are written but unrun here. Run `npm test` in `extension/` to confirm.
- Existing `panel.test.tsx` unaffected by D1/C1: the Dictate button renders only when recognition exists (absent in jsdom), and no existing test queries the old copy link.

## Docs
- `README.md` (root) and `extension/README.md`: updated for in-panel capture, History controls, global notes, paste-code override, summary states, empty-recap wording, dictation, Wiki popup, and test inventory.
- `SPEC.md`: in-panel capture step, global-notes + dictation bullets, History/Wiki interface rows, Resume description, empty-input AI rule, repository status.
- `TECHNICAL_SPEC.md`: status, file inventory, capture step, bulk-delete note, empty-recap prompt rule, validation plan, completion gate.
