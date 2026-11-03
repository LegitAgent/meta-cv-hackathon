# Backtrack

Meta Global AI Developer Hackathon — Build for Your World

**Leave your work. Keep your place.**

Backtrack is a proposed Chrome extension that saves your working context with one click, creates an AI recap, and helps you resume after an interruption. Persistent note tabs provide an optional place for thoughts, similar to Windows Notepad.

## Why

I solve coding problems, get distracted, and sometimes return without remembering where I stopped. Writing documentation before every break would become another chore. Capturing context should require minimal effort; notes should be optional.

## Planned MVP

- User-triggered page checkpoints, initially focused on LeetCode.
- Grounded AI recaps and one suggested next action.
- Autosaving note tabs that persist across browser restarts.
- Local checkpoint history and a lightweight activity log.
- Resume view with saved code, context, and source link.

Notes and history use extension-local storage. AI summaries send selected checkpoint content through a backend to a configured model provider; local storage does not mean offline AI.

## Status

Backtrack implementation lives in `extension/` and `backend/`. See [extension/README.md](extension/README.md) for extension build instructions. The earlier camera prototype source is archived in `docs/archive/camera-prototype/`; its downloaded model weights and root caches were removed.

Read [SPEC.md](SPEC.md) for product requirements and [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) for architecture, storage contracts, backend APIs, and implementation steps. Previous documents are preserved in [docs/archive](docs/archive/).

## Model and deadline

Use Muse through one verified provider. Baseten, Fireworks, and Modal are available options, but model access and credits need verification. The supplied Baseten hackathon identifier is `meta-models/muse-spark-open-1026`.

Deadline: November 5, 2026. Prioritize capture, persistence, notes, and a useful recap. Voice, automatic tracking, and blocking are deferred.
