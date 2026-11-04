# Live review for Muse

## Current status — November 4, 2026

R1–R6 below describe the original findings. The current checkout addresses them:

- R1/R2: per-note outbox, awaited in-flight saves before note switches, revision updates for newer typing, and explicit conflict resolution. Panel tests cover immediate note creation, delayed responses, and a conflict blocking a switch.
- R3/R4: full note snapshots are persisted at summary start; the shared builder reports every transport trim. Pasted code uses a separate code override path with a 30,000-character recap limit and a warning when trimmed. The checkpoint stays immutable.
- R5: the panel and worker check persisted AI enablement; History disables Retry when AI is off.
- R6: partial-code captures offer a full-code paste option.

Validation: 136 extension tests across 22 files, production build, and 53 backend tests across 2 files pass; both typechecks clean. Live Chrome interaction and provider inference still require a configured provider and manual verification.

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

---

# Muse Spark review — 2026-11-05 (full-repo sweep, 6 parallel surfaces + synthesis)

Scope: backend worker, background + capture, storage + shared, panel core, panel components, config + docs. Method: six read-only children opened every cited body, one synthesis child deduped against this file. Line numbers are approximate: the tree is being edited outside these turns (see drift note).

Tree drift note (verified 2026-11-05): `extension/src/panel/styles.css` was restyled outside this session — the `.history-toolbar`, `.history-confirm`, `.history-top`, `.history-all`, `.icon-button`, and `select` rules added earlier are gone, and `ul.history li.selected` changed shape. Separately, `CHECKPOINT_RESUMED` (contracts, validation, background handler, App sender) and screenshot wiring (`SCREENSHOT_MAX`, payload/checkpoint `screenshot`) appeared without a review entry. The sweep ran against the current tree; entries below reflect it.

Verification key: [V] = re-verified against current disk this session. Unmarked = agent-reported from inspected bodies, not independently re-checked. No live-Chrome or provider-inference verification for any entry.

## Bugs (sweep)

- B12 Low [V-disputed, kept] — `backend/worker/src/index.ts:152` — `Bearer` match is case-sensitive, so lowercase `bearer` 401s. Fix: `/^Bearer\s+/i` + test. Note: B1's original claim was already corrected as a redaction artifact; treat B12 as a new robustness nit, not a reopen.
- B13 Low — `backend/worker/src/auth.ts:58` — token-endpoint body uses unbounded `response.json()`. Fix: cap upstream bytes, map over-limit to 503/504.
- B14 Low — `backend/worker/src/schemas.ts:11` + `index.ts:70-76` — `screenshot` accepted as any string, forwarded as `image_url` with no data-URL check. Fix: 422-reject non-`data:image/` before spending budget.
- B15 Low — `backend/worker/src/index.ts:88-93,108-111` — 35s abort racing an oversized provider stream rethrows raw 413. Fix: map to 504 when `signal.aborted`.
- B16 Low — `backend/worker/src/index.ts:197-199` — error mapper drops `AuthError` retryability. Fix: propagate `retryable: true` for network-caused auth failures.
- B17 Low — `backend/worker/src/auth.ts:35-37` — redirect allowlist silently filters to 32-char extension ids, so dev values yield empty list and every exchange 400s. Fix: warn when the allowlist filters everything out.
- B18 Medium — `extension/src/background.ts:449-451` — `tabs.onUpdated` syncs selection for any tab, so a background tab steals `selectedCheckpointId`. Fix: only sync the active tab.
- B19 Low — `extension/src/background.ts:172-182` — LeetCode denial fallback forces `partial` even when the generic outcome was `unavailable`. Fix: keep `unavailable` when nothing was captured.
- B20 Low — `extension/src/background.ts:108,149,185-203` — two `executeScript` passes (generic, LeetCode) share one navigation guard with no mutual URL check. Fix: capture URL per pass, discard on mismatch.
- B21 Low — `extension/src/background.ts:334-336` — `SUMMARY_BEGIN` catch-all maps every throw to `CHECKPOINT_NOT_FOUND`, masking storage/quota failures. Fix: pass through known codes.
- B22 Low — `extension/src/background.ts:282-285` — tab switch clears a failed `meta:lastCapture` banner, discarding failure evidence. Fix: clear only on fresh success.
- B23 Low — `extension/src/background.ts:401-403` — `runCaptureFlow` swallows init failure then writes on un-migrated storage. Fix: abort capture when reconciliation fails.
- B24 Low — `extension/src/capture/leetcode.ts:20` — `PROBLEM_URL_RE` matches only `leetcode.com`; regional hosts fall back to generic. Fix: accept `leetcode.*`.
- B25 Low — `extension/src/capture/leetcode.ts:84-85` — hardcoded 20000/5000 caps instead of `PAGE_TEXT_MAX`/`SELECTED_MAX`. Fix: reuse the shared constants.
- B26 Medium — `extension/src/storage/migrations.ts:50` — reconcile calls `ws.openNoteIds.filter` without shape-guarding; corrupt workspace throws mid-reconcile and the swallow at `background.ts:378` skips remaining repairs. Fix: shape-guard with safe default.
- B27 Medium [V] — `extension/src/storage/repository.ts:231` + `shared/validation.ts:105` — no dedupe of `noteIds`; duplicates double-bill the 10k budget and send twice. Fix: dedupe in validation or `beginSummary`.
- B28 Low — `extension/src/storage/repository.ts:61,67,79` — reads bypass the enqueue queue, so readers can see torn multi-key writes. Fix: route reads through the queue or document the reconciliation-only repair.
- B29 Low — `extension/src/storage/repository.ts:247` — new pending job carries `prev.result`, so a stale recap stays readable beside `pending`. Fix: clear `result` on new job.
- B30 Low [V] — `extension/src/shared/contracts.ts:124` vs `validation.ts:116`, `repository.ts:283`, `background.ts:344` — `SUMMARY_FAIL` type omits `retryAfterSeconds` the runtime passes. Fix: add the optional field to the command type.
- B31 Low — `extension/src/shared/payload.ts:19,27` — `codeOverride` with mismatched `linkedCheckpointId` silently bills as a regular note. Fix: warn/route explicitly.
- B32 Low — `extension/src/shared/payload.ts:52` — `checkpoint.code` ships untrimmed, relying on capture-time caps. Fix: hard cap + warning at payload build.
- B33 Low [V] — `extension/src/shared/contracts.ts:155` — `LIMITS.BODY_BYTES_MAX` defined once, referenced nowhere. Fix: enforce at worker entry or remove.
- B34 Low — `extension/src/storage/migrations.ts:67` + `repository.ts:190` — startup rewrite persists raw record including stale `backendUrl`. Fix: strip `backendUrl` on startup write.
- B35 Low [V] — `extension/src/panel/store.ts:110` — `snapshotFromStorage` spreads stored workspace then unconditionally overwrites `backendUrl` with the default, so a custom backend URL never persists. Fix: keep the stored value when present.
- B36 Low [V] — `extension/src/panel/api.ts:68` — `getHealth` has no timeout while `postSummary` enforces 45s. Fix: add a matching timeout signal.
- B37 Low — `extension/src/panel/api.ts:20` — `postSummary` never checks `opts.signal.aborted` upfront, so an already-aborted signal still sends the POST. Fix: pre-check and throw before fetch.
- B38 Low — `extension/src/panel/App.tsx:431` — auto-summarize calls `runSummary` with startup `includeNoteIds` (normally empty), so automatic recaps never include notes. Fix: resolve the current selection at auto-run time.
- B39 Low — `extension/src/panel/App.tsx:403-404` — whitespace-only paste returns `false` with no `pasteError`, unlike the 50k-length error. Fix: set a "nothing to paste" message.
- B40 Low — `extension/src/panel/App.tsx:354,585` — `SUMMARY_BEGIN` sends `includeNoteIds` verbatim; deletions elsewhere rely on worker missing-note warnings. Fix: prune ids against live notes before sending.
- B41 High — FIXED this session — `extension/src/panel/components/NoteTabs.tsx` — dictation cleanup aborted recognition on note switch without resetting `listening`/`interim`, leaving a stale "Listening…" banner on the new note. Fixed: cleanup now resets both; `tsc` clean.
- B42 High — `extension/src/panel/components/NoteTabs.tsx:43-75` — tabs use `role="tab"` on a non-focusable span with click/double-click and no keyboard handler; keyboard users cannot select/rename tabs. Fix: real tab buttons with Enter/Space select and rename keys.
- B43 Medium — `extension/src/panel/components/ResumeView.tsx:4-13` — `RetryCountdown` interval keeps firing `setNow` forever after reaching zero. Fix: clear the interval once the deadline passes.
- B44 Medium [V, scope confirmed] — `extension/src/panel/components/HistoryView.tsx:184-198` — "Select shown" overwrites `checked` (dropping off-filter selections) while "Trash selected" deletes all checked ids including filter-hidden ones. Fix: bulk-operate on visible-checked only or confirm with explicit scope.
- B45 Medium — `extension/src/panel/components/ResumeView.tsx:208-225` — `copyRecap` `.catch(()=>undefined)` swallows clipboard failures with no UI. Fix: surface a copy-error hint.
- B46 Medium — `extension/src/panel/components/HistoryView.tsx:275-279` — disabled Retry carries its reason only in `title`, which browsers rarely show and screen readers skip. Fix: render visible helper text when AI is disabled.
- B47 Medium — `extension/src/panel/components/NoteTabs.tsx:200-208` — `recog.onerror`/`onend` silently clear state, so denied mic looks like dictation just stopped. Fix: surface a dictation-error hint.
- B48 Medium — `extension/src/panel/components/ResumeView.tsx:130-132` — code preview slices 4000 chars with no truncation indicator. Fix: append a "…truncated" note when clipped.
- B49 Medium — `extension/src/panel/components/WikiHelp.tsx:5-31` — dialog has `aria-modal` but no focus trap, initial focus, or focus return. Fix: trap focus, focus on open, restore trigger on close.
- B50 Low [V, confirmed on current disk] — `extension/src/panel/styles.css` — `.history-confirm`, `.history-toolbar`, `.history-top`, `.history-all`, `.icon-button`, `select`, `.format-bar`, `.preview`, `.saved-notes` have no rules after the outside restyle, so those banners/toolbars render unstyled; `.tab.active` drops the 1px border instead of transparentizing, shifting layout. Fix: restore the missing rules; keep the active border transparent.
- B51 Medium (docs) — `TECHNICAL_SPEC.md:305` says "Enforce output field lengths and list counts with Pydantic" but the backend is TypeScript/Zod. Fix: rewrite the bullet for Zod.
- B52 Medium (docs) — `SPEC.md:202-206` + `TECHNICAL_SPEC.md:316` cite `meta-models/muse-spark-open-1026` (Baseten) and `provider.py`/`AI_PROVIDER=baseten` vs actual `wrangler.jsonc:17-18` direct-Muse `muse-spark-1.3`. Fix: align docs to the real provider/model.
- B53 Medium (docs) — `TECHNICAL_SPEC.md:190` SummaryJob contract still carries `inputHash`, removed by B11. Fix: drop the field.
- B54 Low (docs) — `TECHNICAL_SPEC.md:88-100` manifest snippet omits `identity,tabs` granted in `extension/public/manifest.json:8`. Fix: update the snippet.
- B55 Low (docs) — FIXED this session — `SPEC.md:30` kept dictation under Deferred after implementing it. Fixed: Deferred restored to "Microphone and voice output." (dictation already documented under note tabs).
- B56 Low (docs) — `TECHNICAL_SPEC.md:318` env `ALLOWED_EXTENSION_ORIGIN` (singular) vs actual `ALLOWED_EXTENSION_ORIGINS`. Fix: correct the name.
- B57 Low (docs) — `README.md:70,104` vs `wrangler.jsonc:15` — table implies `GOOGLE_CLIENT_ID` is a user placeholder while the file pins a real client ID. Fix: clarify the committed ID is a public default and when to override.

## QOL opportunities (sweep)

- Q7 — `backend/worker/src/index.ts:160-161` — 413 message hardcodes "256 KiB" while the cap is `BODY_LIMIT`. Interpolate the constant.
- Q8 — `backend/worker/src/index.ts:60,173` — cache digest hashes raw `AI_BASE_URL` while fetch normalizes the trailing slash, duplicating cache entries. Hash the normalized URL.
- Q9 — `extension/src/capture/leetcode.ts:170` — `extractLeetCodeCodeInPage` is dead code (background imports only the other three). Remove or wire as MAIN-world fallback.
- Q10 — `extension/src/background.ts:291` — command switch has no default/never-exhaustiveness guard, so schema drift resolves `sendResponse(undefined)`. Add a default returning `INVALID_COMMAND`.
- Q11 — `extension/src/storage/migrations.ts:70,114` — every closed note reported as `orphanNoteIds` (noise) and same-ms event pruning drops in arbitrary order. Only report truly orphaned notes; keep newest on ties.
- Q12 — `extension/src/panel/App.tsx:441` — `exportJson` has no try/catch and always downloads `backtrack-export.json`. Catch failures with UI feedback; timestamp the filename.
- Q13 — `extension/package.json:14` vs `backend/worker/package.json:14` — zod ^3 vs ^4 (worker uses zod-4-only `z.toJSONSchema`). Pin/align or document the split.
- Q14 — `extension/package.json:26` vs `backend/worker/package.json:19` — vitest ^2 vs ^5 major drift. Align on one major.
- Q15 — `TECHNICAL_SPEC.md:102`, `manifest.json:9`, `README.md:88` — "local host permission for the demo proxy" is stale; manifest already pins https-only. Rewrite as fixed-URL + source-change local-test flow.

Unresolved: live-Chrome interaction and real provider inference were not inspected (all source/test-level); UI-timing, quota, and model-output effects remain unverified. One prior Medium (note-switch conflict trap) was deliberately not re-inspected per B3's recorded intent — reopen on reproduction.

---

# Fix pass — 2026-11-05 (all sweep items dispositioned)

Fixed: B12 (case-insensitive Bearer + test), B13 (upstream body cap + parse mapping + tests), B14 (screenshot data-URL refine + test), B15 (413+aborted maps to 504 + race test), B16 (AuthError.retryable passthrough + test), B17 (empty allowlist 503 + test), B18 (active-tab guard + background-tab test), B19 (unavailable preserved + test), B20 (cross-pass URL compare + race test), B21 (known-code passthrough), B23 (init failure aborts capture), B24 (leetcode.cn/www + tests), B25 (shared caps), B26 (workspace shape-guard + corrupt-record test), B27 (note-id dedupe + test), B28 (reads-bypass-queue documented in code), B30 (SUMMARY_FAIL retryAfterSeconds type), B31 (mismatch warning + test), B32 (payload code cap + test), B33 (dead constant removed), B34 (startup write keeps known fields only + no-backendUrl test), B36 (health timeout), B37 (pre-check aborted signal), B39 (empty-paste message), B40 (prune deleted ids before SUMMARY_BEGIN), B42 (keyboard-operable tab titles, span contract kept), B43 (countdown interval cleared), B44 (union select + hidden-scope confirm text + test), B45 (copy-error hint + test), B46 (inline retry helper + test), B47 (dictation-error hint), B48 (truncation note), B49 (wiki focus trap + initial/return focus + test), B50 (missing history/toolbar/preview/saved-notes/select rules restored, .tab.active keeps its border), B51–B54 + B56–B57 (doc corrections), Q7 (interpolated cap), Q8 (normalized digest + cache test), Q9 (dead extractor removed), Q10 (default INVALID_COMMAND), Q11 (left as-is: orphanNoteIds is write-only, closed-note entries are harmless; event ties already deterministic via stable sort), Q12 (export try/catch + timestamped filename + error UI), Q15 (fixed-URL wording; README already compliant).

Rejected with rationale: B29 (clearing result would destroy the SPEC §9 guarantee that a failed retry preserves the last good recap), B35 (fixed backend URL is intentional; stored values are ignored by design), B38 (auto-run already uses the live selection via its runSummary dep; empty selection is the explicit-selection rule, not a bug). Q13/Q14 deferred: no lockstep upgrades without running both suites; recorded in TECHNICAL_SPEC §12.

Live-collision note (2026-11-05): the tree is being edited by another party mid-session. A history-layout fix (container queries, fluid rows, ellipsis titles, filter grid) is complete, but `tsc` is currently red on their half-applied ResumeView edit: `onCapture` compared to `false` (91), `copyError` (144) and `aiEnabled` (206) used but not destructured. Left untouched to avoid colliding; finish that edit, then re-run typecheck plus `npm test`.

Follow-up fix (user-reported stuck SCRIPT_DENIED banner): B22 revisited and fixed properly. The banner clear sat after early returns in syncSelectionToTab, so unreadable URLs or missing task keys trapped it. The clear is now a standalone clearFailureBanner that runs before any early return, on every tab switch and on every finished navigation regardless of readability or active-tab status; selection syncing keeps its active-tab guard. The banner also gained a manual Dismiss button. Regression test: banner clears on navigation even when the tab cannot be read. Typecheck clean; extension tests could not run in this session (sandbox blocks the runner, escalation unavailable) — run `npm test` in `extension/` to confirm.

Regression caught by the suite: the first B42 attempt (span→button) broke 4 panel tests that query `span[title='Double-click to rename']`. Reworked to a focusable span with Enter/Space/F2 handling, keeping the contract. Full extension suite now 127/127 across 20 files; backend 48/48; both typechecks clean.

Flakiness note (pre-existing, intermittent): 4 autosave-timing tests in `panel.test.tsx` failed under parallel file execution in two runs (before and after this fix pass) but pass alone, serially, and in a later parallel re-run (127/127). Load-based flakiness in the tests, not a regression; re-run on failure before treating it as a break.

---

# Note folders — 2026-11-05 (feature)

Notes can live in named folders (`folder:<uuid>` records, `Note.folderId`, unfiled = null). Notes view has a Folders card (create/rename/delete with inline confirm; delete keeps notes as Unfiled), a folder dropdown filter, per-note folder selects, and folder names on saved rows. Resume's **Notes to include** shows folder checkboxes with live counts (empty folders disabled); ticking a folder expands to all its notes at send time via `expandNoteSelection`, so moves are resolved live and duplicates collapse. New commands `FOLDER_CREATE/RENAME/DELETE` + `NOTE_MOVE` (metadata-only, no revision bump, missing folder → `FOLDER_NOT_FOUND`); reconcile unfiles notes whose folder is gone. Covered by repository folder tests, reconcile test, `expandNoteSelection` tests, and a folders UI test. Extension `tsc` clean; full suite could not run in this session (sandbox blocks the runner, escalation unavailable) — run `npm test` in `extension/`.

## Scan — November 5, 2026 (safe-fix pass, user-requested)

Scope was entire repo; fixes limited to safe defects (bugs, dead ends, stale copy) plus missing test coverage. No redesigns, refactors, or permission changes. Every item below was verified against current source before editing; extension suite 136/136 across 22 files, backend 53/53 across 2 files, both typechecks and the production build clean afterward.

Fixed (panel): conflict-path deadlock when the note fetch fails left the save lock set with no banner and blocked all future saves — the lock now clears with an error state (App.tsx). History select and the AI auto-sync effect had unhandled rejections; both surface an action error now. Bulk delete aborted on the first failure without refreshing; per-id try/catch always refreshes and reports the count. Export clicked a detached anchor; it is appended and removed now. A failed capture wiped the typed stuck-point text; it is kept unless the save succeeds (captureNow returns boolean). Copy-code failures were swallowed; they render a role=alert error. The recap button was silently dead with AI disabled; it disables with a hint. Saved notes had no empty-filter state. Rename Enter+unmount-blur fired NOTE_UPDATE twice; Enter now defers to blur for a single commit. The resume note count over-reported until the next recap; deleted ids are pruned on snapshot change. Paste errors persisted across checkpoints; cleared on selection change. Duplicate-text list keys could collide and an empty facts toggle rendered; keys are positional and the toggle hides when empty (ResumeView/SummaryCard quality lists). The timeout message hardcoded 45s; it interpolates the configured deadline (api.ts).

Fixed (worker/capture/storage): stale BODY_BYTES_MAX comment removed (contracts.ts). The early UNSUPPORTED_PAGE return omitted the file-access hint the denied path has; appended (background.ts). Trailing-slash task keys forked one page into two (false NAVIGATION_RACE, lost tab-follow selection); canonicalized in taskKeyForUrl with tolerant matching plus normalized race comparison (types.ts, background.ts). workspaceSchema required backendUrl that reconcile never persists; now optional with BACKEND_URL default (validation.ts). FileReader does not exist in MV3 service workers so screenshot downscaling always failed; blobToDataUrl uses arrayBuffer + chunked btoa (screenshot.ts).

Fixed (docs): TECHNICAL_SPEC still named Baseten (direct Muse API instead); README had the Bearer direction backwards (backend sends, not expects); noted here for the record.

Tests added, no product change: worker-command branch coverage (NOTE_*/WORKSPACE_UPDATE/SUMMARY_*/CHECKPOINT_DELETE/RESUMED/INVALID_COMMAND) in background-capture.test.ts; screenshot passthrough/invalid cases in screenshot.test.ts; live-route coverage (health, auth config + 503, 404, 405 + Allow, 415/400 sign-in posts, overlong Bearer) in backend worker.test.ts.

Not done: UNTRUSTED_SENDER has no branch test (the shared send helper always passes a trusted sender; changing it risks the existing capture tests). Live-Chrome and real provider inference remain unverified (no credentials in scope).
