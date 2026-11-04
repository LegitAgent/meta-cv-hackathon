# Backtrack

Leave your work. Keep your place.

Backtrack is a Chrome side-panel extension for resuming unfinished work after an interruption — no handoff document needed. Capture any page as a checkpoint, jot notes (or dictate them), and get a Muse recap that tells you exactly where you left off and what to do next. Built for the Meta Global AI Developer Hackathon — Build for Your World.

## What it does

- **One-click capture.** Save the current tab from the toolbar or the in-panel **Save this page** / **Save again** button. Switching browser tabs jumps to that tab's checkpoint.
- **Honest capture quality.** Every checkpoint is labeled `complete`, `partial`, or `unavailable`, with missing, truncated, and warning details. The in-panel **Wiki** popup explains what each label means.
- **Muse recaps.** Generates a grounded recap of the captured attempt: what was tried, a suggested next action, and explicitly labeled uncertainty. Empty captures get an honest "you didn't add anything to recap" instead of invented work.
- **Notes, tabs, and folders.** Persistent note tabs with autosave, conflict handling, saved-note search/sort/filter, and folders. Organize notes into folders and tick a folder to include all its notes in a recap.
- **Mic dictation.** The Dictate button in the editor transcribes speech into the note via Chrome's built-in speech recognition. No API key needed.
- **History that scales.** Search, quality/summary filters, newest/oldest/title sort, per-row Trash with inline confirm, bulk **Trash selected**, and activity log. Deleting a checkpoint never deletes linked notes.
- **Paste-code fallback.** When code capture is missing or partial, paste it in. Pasted code is stored as a linked note and replaces captured code for the next recap only; checkpoints stay immutable.
- **Resilient summaries.** Summary states (`idle`, `pending`, `complete`, `failed`) with retry, recap warnings, copy button, observed-facts toggle, and a 429 countdown.
- **Privacy-first.** Notes and checkpoints stay in local browser storage. Only content you explicitly include is sent to the backend and the direct Muse API. Capture and notes work without AI.

## Features at a glance

| Area | Highlights |
| --- | --- |
| Resume | In-panel capture, quality badge, source links, code copy, paste-code fallback, auto-summarize consent, recap, warnings, retry, JSON export |
| Notes | Tabs, autosave, conflict resolution, saved notes, folders with counts, folder filter, dictation, Google sign-in and account controls |
| History | Text search, quality + summary filters, sort, checkbox selection, inline single and bulk trash, summary retry, activity list |
| Wiki | Mini popup explaining capture-quality codes |

## Architecture

Two parts, no database:

- **Extension (`extension/`, TypeScript + React).** A side-panel React app (Resume / Notes / History / Wiki) plus a single-writer background service worker. The worker owns capture orchestration (generic + LeetCode adapters), tab-follow selection, typed commands, and a message queue. All persistent state lives in `chrome.storage.local` under separate keys: `meta`, `workspace`, `checkpoint:<uuid>`, `summary:<checkpointId>`, `note:<uuid>`, `folder:<uuid>`, `event:<uuid>`. The panel never writes storage directly except reads; the worker serializes every mutation, with startup reconciliation for torn writes.
- **Backend (`backend/worker/`, Cloudflare Worker).** A thin authenticated proxy to the direct Muse API (`/chat/completions`). It verifies Google identity tokens (Gmail accounts via OAuth), rate-limits per IP and per account, validates bodies (256 KiB cap), enforces timeouts, and caches validated summaries for five minutes (`CACHE_TTL_SECONDS=0` disables this). No KV, database, or R2 bucket. The Worker never logs note bodies, code, or keys.

## Run locally (unpacked extension)

You need Node.js 22 LTS or newer and Chrome. The unpacked-extension flow below is the supported way to run Backtrack until the store listing is approved.

> **No local backend needed — it is already deployed at `https://backtrack.martinalba.dev`, and the extension connects to it automatically.** Skip straight to step 4 after loading the extension. Only follow the Worker setup in step 3 if you are modifying the backend itself.

**1. Build the extension**

From the repository root:

```powershell
cd extension
npm install
npm run build
```

**2. Load it unpacked in Chrome**

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension/dist` folder.
4. Pin Backtrack's toolbar button so the side panel is one click away.
5. Copy the extension ID from its card — you need it for the backend's allowed-origins list.

**3. Backend — already deployed (optional: only for Worker development)**

**The deployed backend at `https://backtrack.martinalba.dev` is live, so you can skip this step entirely for normal use.** Only set up a local Worker if you are changing backend code.

Open another terminal at the repository root:

```powershell
cd backend/worker
npm install
Copy-Item .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```dotenv
AI_API_KEY="your-muse-api-key"
AI_BASE_URL="your-verified-muse-api-base-url"
AI_MODEL="your-direct-muse-model-id"
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
ALLOWED_EXTENSION_ORIGINS="chrome-extension://your-extension-id"
```

Set up a Google OAuth Web application client using [the Google sign-in guide](docs/google-sign-in.md). Only verified `@gmail.com` accounts can use AI. Keep `.dev.vars` private. Nonsecret defaults live in `backend/worker/wrangler.jsonc` (`AI_BASE_URL` `https://api.meta.ai/v1`, `AI_MODEL` `muse-spark-1.3`, `CACHE_TTL_SECONDS` `300`).

Start the Worker and keep the terminal open:

```powershell
npm run dev
```

`http://127.0.0.1:8001/health` returns service status. `providerConfigured: true` means configuration is present, not that the provider has accepted the key or model.

**4. Connect Backtrack**

Open a webpage, click Backtrack, expand **Account**, and click **Sign in with Google**. Choose a Gmail account, enable AI, and generate a recap. The extension targets the hosted backend (`https://backtrack.martinalba.dev`); testing against a local origin requires a developer source change in `extension/src/shared/config.ts` plus the matching manifest host permission, followed by a rebuild. Your short-lived Google identity token stays in Chrome session storage — sign in again after it expires or Chrome restarts. Never enter your Muse API key in the extension.

After extension changes, run `npm run build` in `extension`, click **Reload** on its Chrome extension card, and reopen the panel.

**5. Checks and troubleshooting**

```powershell
# In extension/
npm test
npm run build

# In backend/worker/
npm test
npm run build
```

- 401: sign in with Google again under Account.
- 403: use a verified Gmail account and check the extension ID in ALLOWED_EXTENSION_ORIGINS.
- 429: wait for the rate-limit window; avoid repeated retries.
- 503: check Worker secrets and provider configuration.
- 502: check the direct Muse API model access, account credits, and API key; errors are sanitized.
- No network connection: confirm the deployed Worker and its custom domain are reachable.

Implementation references: [Cloudflare rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).

## Publishing status

Backtrack is submitted to the Chrome Web Store and is currently pending Google's review. Approval typically takes at least a couple of days before the listing becomes eligible, so until then please run it as an unpacked extension using the steps above.
