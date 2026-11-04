# Backtrack extension (TypeScript + React)

MV3 side-panel extension per `TECHNICAL_SPEC.md` sections 1–8, 11–13.

## Layout

- `package.json`, `vite.config.ts` (explicit `panel` + `background` entries), `tsconfig.json`, `panel.html`
- `public/manifest.json` — MV3 with fixed backend host permission `https://backtrack.martinalba.dev/*`; no optional access to arbitrary backend origins.
- `src/background.ts` — single-writer worker, capture orchestration, typed commands, message queue
- `src/capture/` — generic + LeetCode adapters (`types.ts`), extraction functions bundled into the worker, no CDN
- `src/storage/` — `repository.ts` (queue + revision conflicts) + `migrations.ts` (startup reconciliation)
- `src/shared/` — `contracts.ts` (storage keys `meta`/`workspace`/`checkpoint:`/`summary:`/`note:`/`event:`) + `validation.ts` (Zod boundaries)
- `src/panel/` — React app (`main.tsx`, `App.tsx`, `api.ts` with 45s AbortController, `store.ts`, `components/`, `styles.css`)
- `tests/` — Vitest suites + adapter fixtures

## Commands

- `npm install`
- `npm run build` → `extension/dist` (load unpacked from `dist`)
- `npm test`

## Backend

Use `../backend/worker/` (Cloudflare Worker; fixed URL `https://backtrack.martinalba.dev`). See the root README for secrets, local testing, and deployment. In the panel's **Account** section, sign in with Google using a Gmail account. The short-lived identity token is scoped to the fixed backend origin and kept only in Chrome session storage. See [Google OAuth setup](../docs/google-sign-in.md). Developers can change `src/shared/config.ts` and the manifest host permission for a local test build; saved workspace URLs are ignored.

