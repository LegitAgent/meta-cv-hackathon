# Backtrack extension (TypeScript + React)

MV3 side-panel extension per `TECHNICAL_SPEC.md` sections 1–8, 11–13.

## Layout

- `package.json`, `vite.config.ts` (explicit `panel` + `background` entries), `tsconfig.json`, `panel.html`
- `public/manifest.json` — MV3, `activeTab`/`scripting`/`storage`/`sidePanel`, `host_permissions` `http://127.0.0.1/*` only
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

See `../backend/` (FastAPI proxy on `127.0.0.1:8001`). The camera prototype (`app.py`) is untouched.
