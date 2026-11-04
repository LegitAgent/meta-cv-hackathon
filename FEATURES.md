# Backtrack — Features & Technicalities

Backtrack is a Chrome (MV3) side-panel extension + Cloudflare Worker backend that
saves where you were (checkpoints), keeps local notes, and generates short
AI recaps on demand. Checkpoints are immutable; nothing is ever overwritten.

## Extension shell

- Toolbar button tooltip is "Pause here". Clicking it only OPENS the side
  panel — it never captures. Checkpoints are created only by the in-panel
  "Save this page" button.
- Panel tabs: Resume, Notes, History, Account section, Wiki guide (?).
- Footer shows the build version (currently 0.2.0).
- Support: Chrome 116+. Loaded unpacked from `extension/dist`
  (`npm run build` produces it via `tsc --noEmit` + `vite build`).

## Capture ("Save this page")

- Optional stuck-point box ("Where are you stuck?", max 500 chars, auto-trims
  with a warning) is stored with the checkpoint.
- Extraction runs in-page in two flavors: a generic extractor (title, URL,
  selected text, page text, code) and a LeetCode adapter (problem pages get
  code present/partial/missing labelling). Page text cap 20,000 chars,
  code cap 30,000, selected text cap 5,000.
- A JPEG screenshot of the visible tab is attached when possible (downscaled
  to fit 120,000 chars; text stays the source of truth, failures only add
  a warning). Screenshots never enter the JSON sent to the model; the image
  travels as a separate image part.
- Uncapturable pages fail with a reason instead of saving: browser pages
  (`chrome://`, web store, `about:`, `edge:`), `file://` (needs the
  "Allow access to file URLs" toggle, and the error says so).
- Navigation-race guard discards mixed snapshots if the tab navigates
  mid-capture (trailing-slash-insensitive URL compare).
- Permission model: Chrome only grants tab access where the toolbar button
  was clicked. Saving from the panel on a different tab fails with
  TAB_ACCESS_DENIED telling you to click the icon on that tab first.
  One click covers the tab until it reloads or navigates.
- Outcomes persist as `meta:lastCapture` (ok/failure banner, dismissible);
  switching tabs or finishing a navigation clears a stale failure banner.

## Tab following

- Switching tabs (or same-tab navigation) selects the newest checkpoint for
  that tab's task key (`hostname + pathname`, query/fragment stripped,
  trailing-slash tolerant). The panel updates through the storage listener.
- A tab with no checkpoint clears the selection: the Resume view shows a
  fresh "Save this page" prompt instead of another page's checkpoint.
- Deleting the selected checkpoint falls back to the newest remaining one.

## Resume tab

- Shows the selected checkpoint (title, time, "Saved ✓" pill, Save again
  button), the active summary job, related saves from the same task
  ("Back to where I was"; reopening prefers the existing tab, else opens new).
- Recap requires Google sign-in AND enabled AI; the button disables with a
  hint otherwise. "Summarize new captures automatically" checkbox.
- Retry on failure without touching the checkpoint. Reopen source, Copy code
  (first 4,000 chars shown, copy errors surface inline).
- Paste-code fallback when capture missed code: saved as a note linked to
  the checkpoint (kind `codeOverride`, 50,000-char note limit; recap uses
  at most 30,000 chars with a trim warning).
- Notes to include: tick saved notes to attach their exact text to the next
  recap (linking alone does not include them; the count reads "N of M").

## Notes tab

- Tabbed notes: + Note creates open+active and pre-selects it for recap.
  Double-click (or F2) renames inline (Enter commits via blur, single commit);
  Enter/Space on a tab selects it; × closes the tab but keeps the note.
- Autosave: 400 ms debounce, per-note outbox keyed by id, revision-guarded
  writes. Statuses: Saved / Saving… / Conflict / Save error.
- Conflict: another panel saved first → banner with Keep my draft /
  Use saved version. A missing note clears the lock instead of wedging.
- Formatting toolbar (Bold, Italic, bulleted List) + Preview toggle rendering
  a safe subset (bold/italic/lists, HTML-escaped). Bodies stay plain text.
- Voice dictation via SpeechRecognition with error + dismiss UI.
- Saved-notes list: text filter + sort (Last updated / Newest first /
  Title A–Z), empty-filter message, confirm-before-delete per note.
- Deleting a note drops its pending edits, timers, and conflict state so a
  queued autosave can neither resurrect nor retry it.

## History tab

- Newest-first checkpoint list with capture-quality badges and timestamps.
- Select to resume, Retry failed recaps (disabled with a hint when AI is
  off), per-row Delete with confirm (linked notes are kept), bulk delete via
  checkboxes + Select all with a failure count, Export JSON (timestamped
  file, `schemaVersion: 1`, all records).
- Activity events (captures, resumes, summary failures) power the history
  meta lines.

## Account tab

- Google sign-in restricted to `@gmail.com` (enforced server-side).
- The token is short-lived, kept in Chrome session storage only, never with
  notes. Sign out locks the whole panel behind the sign-in screen; saved
  data stays on device and returns on next sign-in. Switch account supported.

## Wiki guide (? button)

- In-panel docs: standfirst, "On this page" contents, one article each for
  Saving pages, Recaps, Notes, History and account. Closes on backdrop
  click, Close button, or Escape.

## Backend worker (Cloudflare, `backtrack.martinalba.dev`)

- `GET /health` → `{ status: "ok", providerConfigured }`.
- `GET /auth/config` → `{ clientId }`, or 503 AUTH_NOT_CONFIGURED.
- `POST /auth/google` → exchanges an authorization code for the token the
  extension stores (JSON only: 415/400 on wrong shape).
- `POST /api/v1/summaries` → validates the Bearer Google identity token,
  enforces per-note/per-field caps (notes aggregate 10,000 chars) and a
  bounded JSON body, then calls the model. Unknown routes 404; wrong
  methods 405 with an Allow header.
- Auth: Google ID tokens verified against GOOGLE_CLIENT_ID; overlong
  Bearer values rejected before verification. Extension origin allowlist
  enforced with CORS headers.
- Rate limits: per-IP 30/min, per-token 10/min (429 + Retry-After).
- AI: direct Muse API, model `muse-spark-1.3`, temperature 0.2,
  `max_tokens` 4096, `reasoning_effort: low`.
- The model must return strict JSON matching the summary schema
  (`recap` ≤150 words naming the task first, observed facts with source
  fields, nullable blocker, next action, uncertainties). The prompt treats
  all page content as untrusted data, distinguishes problem from attempt,
  demands concrete identifiers, and requires null (not invented) blockers.
- Responses are repaired, not just rejected: code fences stripped,
  overlong fields truncated, invalid list items dropped, single-string
  source fields wrapped. Empty core content still fails validation.
- Cache: Cloudflare cache, TTL from CACHE_TTL_SECONDS (300 s), keyed by
  credential + provider + model + prompt + content (IDs excluded, screenshot
  hashed separately). Only validated summaries are stored; responses carry
  `X-Backtrack-Cache: HIT/MISS`. Cache outages fall through to inference.
- Error codes: ORIGIN_DENIED, AUTH_*, RATE_LIMITED, INVALID_INPUT (422),
  BODY_TOO_LARGE (413), PROVIDER errors, MODEL_OUTPUT_* (502),
  MODEL_REFUSED, CHECKPOINT_NOT_FOUND, STALE_RESULT, METHOD_NOT_ALLOWED.

## Storage & worker internals

- Single-writer design: the service worker serializes all writes through a
  repository queue; the panel sends typed commands (NOTE_CREATE/UPDATE/
  CLOSE/DELETE, WORKSPACE_UPDATE, SUMMARY_BEGIN/COMPLETE/FAIL, CAPTURE,
  CHECKPOINT_DELETE/RESUMED) and reads via snapshots.
- `chrome.storage.local` keys: `meta`, `workspace`, `checkpoint:<id>`,
  `summary:<id>`, `note:<id>`, `event:<id>`, `meta:capturing`,
  `meta:lastCapture`. Startup reconciliation cleans dangling refs, keeps
  orphans, and never persists endpoint URLs.
- Sender check: mutation commands accepted only from extension pages
  (UNTRUSTED_SENDER otherwise); unknown commands get INVALID_COMMAND.

## Permissions (MV3, all used, no broad host access)

- `activeTab` (read the clicked tab), `scripting` (in-page extraction),
  `storage` (local + session), `sidePanel`, `identity` (Google OAuth),
  `tabs` (follow tab switches by URL). Host permission covers only the
  fixed backend origin. No content scripts, no `<all_urls>`.

## Tests

- Extension: panel UI (autosave, conflicts, delete-drops-draft, rename,
  recap gating, guide open/close), worker commands, capture edge cases,
  tab following, repository, payload/validation/store/screenshot units.
- Backend: provider contract, truncation/refusal/malformed-output mapping,
  cache rules, auth, live-route table (health, auth config, unknown
  routes, methods, sign-in validation, overlong bearer).
