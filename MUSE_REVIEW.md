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
