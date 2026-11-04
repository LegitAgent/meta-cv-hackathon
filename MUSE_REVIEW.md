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

Verified: `extension` — `tsc --noEmit` clean, `vitest run` 10 files / 63 tests passed. `backend/worker` — `tsc --noEmit` clean. Worker `vitest` was not run (unsandboxed execution needs approval; prompts are disabled in this session), so backend behavior claims are code-reading only.

## Bugs

### B1 — High: `Bearer` prefix regex corrupts tokens starting with `[REDACTED ]` characters
File: `backend/worker/src/index.ts` (line 136):
`token = ...replace(/^Bearer [REDACTED], "")`. `[REDACTED]` is a character class, not the word REDACTED, and there is no `+` quantifier, so it strips `"Bearer "` plus exactly one following character whenever that character is in `[REDACTED ]`. Any Google identity token whose first character after the space is in that set loses a character, fails `verifyGoogleToken`, and returns 401. Fix: `.replace(/^Bearer\s+/, "")`.

### B2 — Medium: rename-while-typing causes a spurious revision conflict
File: `extension/src/panel/App.tsx` (`onRename`). Rename sends `NOTE_UPDATE` with the snapshot revision while the outbox may hold unsent typing for the same note. The rename bumps the revision, so the queued autosave then hits `REVISION_CONFLICT` and forces manual resolution for what is really one user's linear edits. Fix: drain/flush the outbox before rename, or fold pending text into the rename write.

### B3 — Medium: note switch is blocked by transient save failures
File: `extension/src/panel/App.tsx` (`drainOutbox` + `selectNote`). `flushSave` returns `false` on any failure including requeued transient errors, and `selectNote`/`onCreate`/`onClose` abort the navigation when `drainOutbox()` is false. Since the outbox already preserves per-note text safely across switches, a transient storage failure traps the user on the current note. Consider allowing the switch while keeping the queued edit.

### B4 — Medium: deleted selected notes are silently dropped from the recap request
File: `extension/src/storage/repository.ts` (`beginSummary`). Note IDs with no live record are filtered out with no signal, so a recap can silently cover fewer notes than the user selected. At minimum surface a warning like the existing trim warnings.

### B5 — Low: redundant double `WORKSPACE_UPDATE` on note select
File: `extension/src/panel/App.tsx` (`selectNote`). When the note is not yet open it sends one update for `activeNoteId` and a second adding `openNoteIds`; the second supersedes the first. One write is enough.

### B6 — Low: non-JSON error pages throw `SyntaxError` instead of a friendly error
File: `extension/src/panel/api.ts` (`responseJson`). `await response.json()` runs before the `ok` check, so a Cloudflare/proxy HTML error page escapes as `SyntaxError` with no `code`. Parse defensively and fall back to `HTTP_<status>`.

### B7 — Low: "virtualized lines" warning fires even when nothing was read
Files: `extension/src/capture/leetcode.ts` + `extension/src/background.ts`. `extractLeetCodeProblemInPage` always returns `partial: true`, and `buildLeetCodeOutcome` warns whenever `codePartial` is true — including the all-null case where no editor lines were seen at all. Gate the warning on `code !== null`.

### B8 — Low: missing `code` is hidden when the problem statement is also missing
File: `extension/src/capture/leetcode.ts`. `else if (raw.code === null)` only records missing code when `pageTextFromProblem` exists. When both are absent the quality badge understates what is missing.

### B9 — Low: `innerText` on a detached clone may under-read page text
File: `extension/src/capture/generic.ts`. `innerText` is layout-dependent and can return `""` on detached nodes in some engines, producing `missing: ["pageText"]` on pages that do have text. `textContent` with whitespace collapsing is the safer fallback.

### B10 — Info: dead/untracked files in the tree
`extension/src/panel/components/SignInPage.tsx` (untracked) is not imported anywhere — `App.tsx` renders its own inline sign-in gate. `extension/patch-app2.py`, `patch-shim3.py`, `patch-shim4.py` are untracked helper scripts. Either wire them in or remove them; at minimum `gitignore` them if they are local tooling.

### B11 — Info: `inputHash` is never computed; abort path masks real errors
`beginSummary` always stores `inputHash: null` (dead field — remove it or hash the payload for idempotency logging). In `backend/worker/src/index.ts` (`infer()` catch) any error becomes 504 `UPSTREAM_TIMEOUT` when `controller.signal.aborted` is set, including validation/`ApiError`s already in flight — check `e instanceof ApiError` first.

Not bugs (checked, OK): `.dev.vars` and `.npm-cache/` are properly gitignored; `GOOGLE_CLIENT_ID` in `wrangler.jsonc` is a public client ID by design; `setSummaryWarnings`/`completeSummary`/`failSummary` correctly gate on `requestId`; cache keys include principal + model + prompt + content; `TRUSTED_CONTEXTS` + sender checks are in place.

## QOL recommendations

1. Show the 429 `Retry-After` countdown in the panel instead of a static message; the backend already sends the header.
2. Display `job.warnings` next to the note checklist (currently only under Resume), so users see *which* notes were trimmed before retrying.
3. Name pasted-code notes with the checkpoint title + timestamp; several "Pasted code" notes are indistinguishable in the selector.
4. Add a "copy recap" button on `SummaryCard`; export JSON already exists but recaps cannot be copied in one click.
5. Cap the `Activity` event list growth — events are append-only per checkpoint/summary and will eventually press against `chrome.storage.local` quota alongside the quota handling already in `captureTab`.
6. Combine the two `WORKSPACE_UPDATE` writes in `selectNote` (B5) and debounce `syncSelectionToTab` on rapid tab switches.

## Design choices (as found — mostly sound)

- **Per-note outbox + revision conflicts** (panel owns drafts, worker serializes writes): correct call. Fixes R1/R2 without OT complexity. Residual risks are B2/B3 above, both small deltas on the same design.
- **Snapshot-based summary payload** (`beginSummary` returns checkpoint + note snapshots; `buildSummaryPayload` never rereads live notes): the right fix for R4 and worth keeping. Gap is only the silent-drop in B4.
- **Immutable checkpoints + `codeOverride` notes**: good — pasted code never rewrites captured evidence, and the quality-warning rewrite makes precedence explicit. Budget split (overrides bypass the 10k note aggregate, capped at 30k) is reasonable but should stay documented in UI, as it currently is.
- **Worker as single writer with an in-memory op queue**: appropriate for `chrome.storage.local`'s lack of transactions. Note the queue does not survive worker restart — the 60s stale-pending reconciler covers that; keep both.
- **Gmail-only + short-lived session tokens**: defensible for a hackathon; the `@gmail.com` restriction is a product decision, not a bug, but keep it visible pre-sign-in (the Account card does; the panel gate does).
- **Edge cache keyed by credential-digest + model + prompt + content, 5-min TTL**: sensible cost saver. Cache hits still count against `TOKEN_LIMITER` (limit check runs before cache lookup) — intentional or not, document it: currently a cached recap still spends rate-limit budget.
