# Backtrack extension (TypeScript + React)

MV3 side-panel extension per `TECHNICAL_SPEC.md` sections 1–8, 11–13.

## Layout

- `package.json`, `vite.config.ts` (explicit `panel` + `background` entries), `vitest.config.ts`, `tsconfig.json`, `panel.html`
- `public/manifest.json` — MV3 with fixed backend host permission `https://backtrack.martinalba.dev/*`; permissions include `activeTab`, `scripting`, `storage`, `sidePanel`, `identity`, `tabs`. No optional access to arbitrary backend origins.
- `src/background.ts` — single-writer worker, capture orchestration, tab-follow selection, typed commands, message queue
- `src/capture/` — generic + LeetCode adapters (`types.ts`, `generic.ts`, `leetcode.ts`), extraction functions bundled into the worker, no CDN
- `src/storage/` — `repository.ts` (queue + revision conflicts + summary jobs) + `migrations.ts` (startup reconciliation, activity pruning)
- `src/shared/` — `contracts.ts` (storage keys `meta`/`workspace`/`checkpoint:`/`summary:`/`note:`/`event:`) + `validation.ts` (Zod boundaries) + `payload.ts` (note budget and `codeOverride` handling) + `config.ts`
- `src/panel/` — React app (`main.tsx`, `App.tsx`, `api.ts` with 45s AbortController and `Retry-After` forwarding, `auth.ts`, `store.ts`, `styles.css`)
- `src/panel/components/` — `ResumeView.tsx` (in-panel capture, quality badge, paste-code fallback, recap, copy recap, retry countdown), `NoteTabs.tsx` (editor formatting, preview, mic dictation via built-in speech recognition), `HistoryView.tsx` (search, quality/summary filters, newest/oldest/title sort, checkbox selection, inline single and bulk trash confirm), `AccountSettings.tsx`, `SignInPage.tsx`, `WikiHelp.tsx` (mini quality-code popup)
- `tests/` — Vitest suites plus adapter fixtures, including `history-view.test.tsx` and `panel.test.tsx`

## Panel views

- Resume: current checkpoint, capture quality, recap, next step, warnings, source links, code copy, paste-code fallback, auto-summarize consent, retry.
- Notes: persistent tabs, editable titles, plain-text editor, save indicator, saved-notes list. Notes are global; linking does not auto-include them.
- History: filterable and sortable checkpoints, selection, inline trash and bulk delete, summary retry, activity list.
- Wiki: capture-quality reference (`complete` / `partial` / `unavailable`).

## Commands

- `npm install`
- `npm run typecheck`
- `npm run build` → `extension/dist` (load unpacked from `dist`)
- `npm test`

## Backend

Use `../backend/worker/` (Cloudflare Worker; fixed URL `https://backtrack.martinalba.dev`). See the root README for secrets, local testing, and deployment. In the panel's **Account** section, sign in with Google using a Gmail account. The short-lived identity token is scoped to the fixed backend origin and kept only in Chrome session storage. See [Google OAuth setup](../docs/google-sign-in.md). Developers can change `src/shared/config.ts` and the manifest host permission for a local test build; saved workspace URLs are ignored.

Recaps need AI enabled and an explicit note selection. Checkpoints are immutable; pasted code travels as a linked `codeOverride` note and replaces captured code for that recap only.
