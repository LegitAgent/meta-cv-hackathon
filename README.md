# Backtrack

## Goal

Help you resume unfinished work after an interruption without writing a handoff document. Built for the Meta Global AI Developer Hackathon — Build for Your World.

## What it does

- Saves the current page and available code as a local checkpoint.
- Generates a Muse recap, grounded observations, and a suggested next action.
- Keeps autosaving note tabs and checkpoint history in Chrome.
- Uses a Cloudflare Worker to call the direct Muse API, with authentication, rate limiting, validation, timeouts, and short-lived summary caching.

Notes and checkpoints remain local. Content selected for AI is sent to the backend and the direct Muse API. Validated summaries may be cached at Cloudflare for five minutes; set CACHE_TTL_SECONDS=0 to disable this. Capture and notes work without AI.

## Run locally

Use Node.js 22 LTS or newer and Chrome. The current backend is `backend/worker`; the older Python backend is retained for reference and is not needed for this setup.

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
BACKTRACK_ACCESS_TOKEN="your-random-token-at-least-32-characters"
ALLOWED_EXTENSION_ORIGINS="chrome-extension://your-extension-id"
```

Generate a random token locally, for example:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

This token protects your demo backend. It is separate from your Muse API key. Do not commit `.dev.vars` or paste real keys into chat.

The endpoint and model are intentionally unset until direct Muse API compatibility is verified. The current client expects Bearer authentication, appends `/chat/completions` to AI_BASE_URL, and reads an OpenAI-compatible response. If the direct API differs, its adapter needs updating before use.

The nonsecret settings are in `backend/worker/wrangler.jsonc`:

| Variable | Value / purpose |
| --- | --- |
| AI_BASE_URL | Set to the direct Muse API base URL; currently unset |
| AI_MODEL | Set to the model identifier supplied by the direct Muse API; currently unset |
| ALLOWED_EXTENSION_ORIGINS | Comma-separated exact extension origins; set your actual ID locally and before deployment |
| CACHE_TTL_SECONDS | `300`; set `0` to disable caching |

Start the Worker:

```powershell
npm run dev
```

Keep the terminal open. `http://127.0.0.1:8001/health` returns service status. `providerConfigured: true` indicates configuration is present, not that the direct Muse API has accepted the key or model.

**3. Connect Backtrack**

Open a webpage, click Backtrack, and expand Connection settings:

- Backend URL: `http://127.0.0.1:8001`
- Backend access token: the same value as BACKTRACK_ACCESS_TOKEN

Save the connection, enable AI, and generate a recap. The access token stays in Chrome session storage and must be re-entered after Chrome restarts. Never enter your Muse API key in the extension.

After extension changes, run `npm run build` in `extension`, click Reload on its Chrome extension card, and reopen the panel.

**4. Host the backend on Cloudflare Workers**

From `backend/worker`, set AI_BASE_URL and AI_MODEL in `wrangler.jsonc` using the direct Muse API documentation. Set ALLOWED_EXTENSION_ORIGINS to your actual `chrome-extension://...` origin. Leave API keys out of that file. Then run:

```powershell
npx wrangler login
npx wrangler secret put AI_API_KEY
npx wrangler secret put BACKTRACK_ACCESS_TOKEN
npm run build
npm run deploy
```

Wrangler prompts for each secret. Enter your direct Muse API key and the same demo access token you will use in Chrome. Local `.dev.vars` values are not uploaded automatically.

Copy the deployed HTTPS Worker URL into Backtrack's Connection settings, enter the token, and grant Chrome access to that specific origin when prompted. No Cloudflare KV, database, or R2 bucket is required. Rate-limit bindings are declared in `wrangler.jsonc`; use distinct namespace IDs if you already use these IDs elsewhere in your account.

Defaults: 30 summary requests/minute per IP and 10/minute per access token, including cache hits. Exceeding them returns 429 with Retry-After. Cloudflare limits are approximate and per edge location, not a global billing cap. Cache entries are also local to an edge location; concurrent misses may make separate provider calls. Configure provider spending limits separately. A shared access token is intended for a private hackathon demo; public distribution should use per-user authentication and quotas.

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

- 401: save the correct backend access token in Connection settings.
- 403: check the extension ID in ALLOWED_EXTENSION_ORIGINS.
- 429: wait for the rate-limit window; avoid repeated retries.
- 503: check Worker secrets and provider configuration.
- 502: check the direct Muse API model access, account credits, and API key; errors are sanitized.
- No network connection: confirm the local Worker is running or grant permission for the hosted URL.

Implementation references: [Cloudflare rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).

