# Backtrack

## Goal

Help you resume unfinished work after an interruption without writing a handoff document. Built for the Meta Global AI Developer Hackathon — Build for Your World.

## What it does

- Saves the current tab as a local checkpoint from the toolbar or the in-panel **Save this page** / **Save again** button.
- Shows capture quality as `complete`, `partial`, or `unavailable`, with missing, truncated, and warning details. See the in-panel **Wiki** popup.
- Generates a Muse recap with grounded observations, a suggested next action, and labeled uncertainty.
- Keeps tabs for Resume, Notes, History, plus a small Wiki popup with the quality table.
- History has text search, quality and summary filters, newest/oldest/title sort, per-row **Trash** with inline `Delete` / `Keep`, and bulk **Trash selected** with an inline count confirm. No native `confirm()` dialogs. Deleting a checkpoint keeps linked notes.
- Notes are global, not per-page. `linkedCheckpointId` is optional metadata; linking does not auto-include a note. Tick notes under **Notes to include** to send them.
- Missing or partial code offers a paste-code fallback. Pasted code is saved as a linked `codeOverride` note and replaces captured code for the next recap only; the checkpoint stays immutable.
- Summary states are `idle`, `pending`, `complete`, and `failed`. Failed recaps show the error, recap warnings, retry, and a 429 countdown when the backend sends `Retry-After`. Empty captures get an honest recap saying you didn't add anything to recap, plus what to add next.
- Notes support mic dictation with the Dictate button in the editor toolbar, using Chrome's free built-in speech recognition. No API key needed. Spoken words are inserted at the cursor and autosave like typed text.
- Recap card supports **Copy recap** and an observed-facts toggle.
- Autosaving note tabs, workspace selection, activity history, Google sign-in, and JSON export.
- Switching browser tabs jumps to that tab's checkpoint. Tabs without a checkpoint are skipped.
- Uses a Cloudflare Worker to call the direct Muse API, with authentication, rate limiting, validation, timeouts, and short-lived summary caching.

Notes and checkpoints remain local. Content selected for AI is sent to the backend and the direct Muse API. Validated summaries may be cached at Cloudflare for five minutes; set CACHE_TTL_SECONDS=0 to disable this. Capture and notes work without AI.

## Run locally

Use Node.js 22 LTS or newer and Chrome. The backend is the Cloudflare Worker in `backend/worker`.

**1. Build and load the extension**

From the repository root:

```powershell
cd extension
npm install
npm run build
```

Open `chrome://extensions`, enable Developer mode, select Load unpacked, and choose `extension/dist`. Copy Backtrack's extension ID and pin its toolbar button.

**2. Configure direct Muse access and the Worker**

Open another terminal at the repository root:

```powershell
cd backend/worker
npm install
Copy-Item .dev.vars.example .dev.vars
```

Edit `.dev.vars` with these values:

```dotenv
AI_API_KEY="your-muse-api-key"
AI_BASE_URL="your-verified-muse-api-base-url"
AI_MODEL="your-direct-muse-model-id"
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
ALLOWED_EXTENSION_ORIGINS="chrome-extension://your-extension-id"
```

Set up a Google OAuth Web application client using [the Google sign-in guide](docs/google-sign-in.md). Only verified `@gmail.com` accounts can use AI. Keep `.dev.vars` private. The backend expects Bearer [REDACTED] from the direct Muse API and appends `/chat/completions` to AI_BASE_URL.

The nonsecret settings are in `backend/worker/wrangler.jsonc`:

| Variable | Value / purpose |
| --- | --- |
| AI_BASE_URL | `https://api.meta.ai/v1` |
| AI_MODEL | `muse-spark-1.3` |
| GOOGLE_CLIENT_ID | Your Google OAuth Web application client ID (public) |
| ALLOWED_EXTENSION_ORIGINS | Comma-separated exact extension origins; set your actual ID locally and before deployment |
| CACHE_TTL_SECONDS | `300`; set `0` to disable caching |

Start the Worker:

```powershell
npm run dev
```

Keep the terminal open. `http://127.0.0.1:8001/health` returns service status locally (`https://backtrack.martinalba.dev/health` once deployed). `providerConfigured: true` indicates configuration is present, not that the direct Muse API has accepted the key or model.

**3. Connect Backtrack**

Open a webpage, click Backtrack, expand **Account**, and click **Sign in with Google**. Choose a Gmail account, enable AI, and generate a recap. Backtrack automatically connects to `https://backtrack.martinalba.dev`; users do not configure a backend URL. Your short-lived Google identity token stays in Chrome session storage. Sign in again after it expires or Chrome restarts. Never enter your Muse API key in the extension.

In the panel, **Resume** handles capture, quality, source links, code copy, paste-code fallback, auto-summarize consent, recap, warnings, and retry. **Notes** handles tabs and saved notes. **History** handles checkpoint search, filters, sort, selection, trash, retry, and activity. **Wiki** explains the quality codes.

The local Worker can still be tested directly at `http://127.0.0.1:8001`. The extension targets the hosted backend; testing it against a different origin requires a developer source change in `extension/src/shared/config.ts` and the matching manifest host permission, followed by a rebuild.

After extension changes, run `npm run build` in `extension`, click Reload on its Chrome extension card, and reopen the panel.

**4. Host the backend on Cloudflare Workers**

From `backend/worker`, set AI_BASE_URL and AI_MODEL in `wrangler.jsonc` using the direct Muse API documentation. Set ALLOWED_EXTENSION_ORIGINS to your actual `chrome-extension://...` origin. Leave API keys out of that file. Then run:

```powershell
npx wrangler login
npx wrangler secret put AI_API_KEY
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run build
npm run deploy
```

Set GOOGLE_CLIENT_ID in wrangler.jsonc before deployment. Wrangler prompts for the Muse API key and Google client secret. Local `.dev.vars` values are not uploaded automatically. BACKTRACK_ACCESS_TOKEN is no longer used.

Connect the deployed Worker to `backtrack.martinalba.dev`, then sign in through the extension's **Account** section. No Cloudflare KV, database, or R2 bucket is required. Rate-limit bindings are declared in `wrangler.jsonc`; use distinct namespace IDs if you already use these IDs elsewhere in your account.

Defaults: 30 summary requests/minute per IP and 10/minute per Google account, including cache hits. Exceeding them returns 429 with Retry-After. Cloudflare limits are approximate and per edge location, not a global billing cap. Cache entries are also local to an edge location; concurrent misses may make separate provider calls. Configure provider spending limits separately. All verified Gmail accounts accepted by your Google OAuth app can request recaps; sign-in does not restrict access to an owner-only list.

Request bodies are capped at 256 KiB, provider responses are validated, and failed responses are not cached. Cache keys include the access identity, model, prompt, and content. Client responses use no-store. The Worker does not log note bodies, code, or keys.

**5. Checks and troubleshooting**

```powershell
# In extension/
npm test
npm run build

# In backend/worker/
npm test
npm run build
```

Extension tests cover adapters, repository, payload, store, panel flows, history filter/sort/trash, auth, tab follow, and validation. Backend tests cover summaries and auth.

- 401: sign in with Google again under Account.
- 403: use a verified Gmail account and check the extension ID in ALLOWED_EXTENSION_ORIGINS.
- 429: wait for the rate-limit window; avoid repeated retries.
- 503: check Worker secrets and provider configuration.
- 502: check the direct Muse API model access, account credits, and API key; errors are sanitized.
- No network connection: confirm the deployed Worker and its custom domain are reachable.

Implementation references: [Cloudflare rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).
