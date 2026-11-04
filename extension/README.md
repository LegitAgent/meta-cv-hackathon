# Backtrack — Leave your work. Keep your place.

A Chrome MV3 side-panel extension for one question: **"What was I doing before I got distracted?"**

## Features

- **Deliberate save** — one "Save this page" button freezes the moment: title, URL, page text, selection, code, language, and a compressed screenshot. Saved locally before anything else happens; the green **Saved ✓ + Save again** states make it clear every save is a new immutable checkpoint, never an overwrite.
- **Stuck-point tag** — an optional "Where are you stuck?" line saved with the checkpoint and sent with the recap request, so the summary targets your actual problem.
- **AI recap** — a ≤150-word account of *your attempt* (never a solution), with observed facts cited to their sources, one inferred possible blocker, one concrete next action, and honest uncertainties. Inputs are frozen at request time; code is capped at 30k chars and notes share a 10k budget, with every trim shown as a warning.
- **Copy recap** — one blue button at the bottom of the recap card copies the recap + next action for standups and commit messages, flashing green on success.
- **Resume stack** — "Back to where I was": the newest saves from the same task, each reopening its page. Reopening focuses the existing tab when it's already open and logs a `checkpoint.resumed` event; saved code is never touched.
- **Attempt diff** — History's **Compare with previous** shows added/removed code lines between same-task saves, so you can see what past-you already tried. No AI needed.
- **History** — filterable, sortable checkpoint list (title/URL search, quality + summary filters, newest/oldest/A–Z), single and bulk trash (linked notes are always kept), failed-summary retry, and an activity trail of captures, resumes, summaries, and notes.
- **Persistent notes** — tabbed plain-text editor with autosave, save/error/conflict states, restart-proof titles/order/selection, dictation + formatting, and a **paste-code fallback** when a page won't yield your full code (saved as a linked `codeOverride` note that replaces captured code for that recap only).
- **Google sign-in gate** — the panel shows only the sign-in page until you're authenticated; local notes and saves work regardless, recaps require an account. Short-lived tokens stay in Chrome session storage; provider keys never enter the browser.
- **Honest failures** — restricted pages, denied access, quota, and failed AI requests all surface as plain-language banners with the checkpoint intact. Saving can never wedge: flags always clear and the Save button always re-enables.
- **Guide** — the Wiki button explains every control and the product goal in one screen.

## Layout

- `package.json`, `vite.config.ts` (explicit `panel` + `background` entries), `vitest.config.ts`, `tsconfig.json`, `panel.html`
- `public/manifest.json` — MV3 with fixed backend host permission `https://backtrack.martinalba.dev/*`; permissions `activeTab`, `scripting`, `storage`, `sidePanel`, `identity`, `tabs`. `public/icons/` holds the extension icons (16/32/48/128).
- `src/background.ts` — single-writer worker, capture orchestration, tab-follow selection, typed commands, message queue
- `src/capture/` — generic + LeetCode adapters (`types.ts`, `generic.ts`, `leetcode.ts`), screenshot supplement, extraction functions bundled into the worker, no CDN
- `src/storage/` — `repository.ts` (queue + revision conflicts + summary jobs + resume events) + `migrations.ts` (startup reconciliation, activity pruning)
- `src/shared/` — `contracts.ts`, `validation.ts` (Zod boundaries), `payload.ts` (budgets, `codeOverride`), `diff.ts` (attempt diff), `config.ts`
- `src/panel/` — React app (`main.tsx`, `App.tsx`, `api.ts` with 45s AbortController and `Retry-After` forwarding, `auth.ts`, `store.ts`, `reopen.ts`, `styles.css`)
- `src/panel/components/` — `ResumeView.tsx`, `NoteTabs.tsx`, `HistoryView.tsx`, `AccountSettings.tsx`, `SignInPage.tsx`, `WikiHelp.tsx`
- `tests/` — Vitest suites plus adapter fixtures

## Panel views

- Resume: current checkpoint, capture quality, stuck point, recap, next step, warnings, source links, resume stack, code copy, paste-code fallback, auto-summarize consent, retry.
- Notes: persistent tabs, editable titles, plain-text editor, save indicator, saved-notes list. Notes are global; linking does not auto-include them.
- History: filterable/sortable checkpoints, compare-with-previous diff, selection, inline trash and bulk delete, summary retry, activity list.
- Wiki: guide to every button and the product goal.

## Commands

- `npm install`
- `npm run typecheck`
- `npm run build` → `extension/dist` (load unpacked from `dist`)
- `npm test`

## Backend

Use `../backend/worker/` (Cloudflare Worker; fixed URL `https://backtrack.martinalba.dev`). See the root README for secrets, local testing, and deployment. Sign in with Google using a Gmail account; the short-lived identity token is scoped to the fixed backend origin and kept only in Chrome session storage. See [Google OAuth setup](../docs/google-sign-in.md). Developers can change `src/shared/config.ts` and the manifest host permission for a local test build; saved workspace URLs are ignored.

Recaps need AI enabled and an explicit note selection. Checkpoints are immutable; pasted code travels as a linked `codeOverride` note and replaces captured code for that recap only.
