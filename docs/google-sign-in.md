# Google sign-in setup

Backtrack uses Google OAuth authorization code flow with PKCE, state, and an OpenID Connect nonce. The Worker verifies Google's RS256 signature, issuer, audience, expiry, and verified Gmail address. Only `openid email` scopes are requested; there is no Gmail inbox access. No password database or shared backend access token is needed.

## Create the Google client

1. Open [Google Cloud Console](https://console.cloud.google.com/), select or create a project, and open **Google Auth Platform**.
2. Complete Branding and Audience setup. Choose **External** for personal Gmail accounts. While testing, add your Gmail address and your testers under Audience → Test users.
3. Under Data Access, use only the basic `openid` and email scopes.
4. Under Clients, create an OAuth client with application type **Web application**. This implementation exchanges codes on the Worker using a client secret; do not select the Chrome extension client type.
5. Add this exact **Authorized redirect URI**, including the trailing slash:

   ```text
   https://icmegjccphakockngdmbdbkfehdpfcfa.chromiumapp.org/
   ```

6. Save the client ID and client secret. The client ID is public. Keep the secret only on the Worker (or in gitignored `.dev.vars` for local development). No authorized JavaScript origin is needed for this redirect flow.

The redirect is derived from the fixed key in `extension/public/manifest.json`. If you change that key, update the redirect in Google and `ALLOWED_EXTENSION_ORIGINS` on the Worker together.

## Configure and deploy

Set `GOOGLE_CLIENT_ID` inside the existing `vars` object in `backend/worker/wrangler.jsonc`:

```jsonc
"GOOGLE_CLIENT_ID": "YOUR_CLIENT_ID.apps.googleusercontent.com"
```

From `backend/worker`:

```powershell
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run build
npm run deploy
```

Paste the Google client secret at the prompt. Keep the existing `AI_API_KEY` secret. The old `BACKTRACK_ACCESS_TOKEN` secret is ignored by the new code and can be deleted from Cloudflare after migration. No new signing secret, database, or KV namespace is required.

For local development, put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in `.dev.vars`. Existing `.dev.vars` files are not overwritten automatically; remove old shared-token settings and update them using `.dev.vars.example`. Local overrides can take precedence over wrangler.jsonc settings.

## Use and verify

1. Run `npm run build` in `extension` and reload Backtrack at `chrome://extensions` to activate the new `identity` permission.
2. Open **Account** and click **Sign in with Google**. The extension automatically uses `https://backtrack.martinalba.dev`.
3. Choose a verified Gmail account; the panel should show its email. Enable AI and generate a recap.
4. Sign out and verify that a new recap asks you to sign in. Existing notes and saved recaps remain local.

Identity tokens are short-lived (Google normally issues them for about an hour) and stored only in Chrome session storage. Sign in again on expiry or after restarting Chrome. Sign-out clears this device's stored credential; it does not revoke an already issued Google ID token before its expiry. There is no silent refresh or account-based note synchronization in this version.

Rate limits and summary cache keys use Google's stable user ID, not an email or individual token, so signing in again does not reset an account's request limit. All verified Gmail accounts accepted by your Google OAuth app can use the backend; there is no separate invitation list. Per-account limits are not a global provider spending cap.

## Troubleshooting

- `redirect_uri_mismatch`: compare the redirect URI above exactly, including its trailing slash. Confirm the extension ID.
- Google denies access: check the consent screen and test users while the app is in testing mode.
- `AUTH_NOT_CONFIGURED`: set the client ID and client secret on the Worker. Check `.dev.vars` overrides for local development.
- `GMAIL_REQUIRED`: use a verified `@gmail.com` address; Workspace and other email domains are intentionally excluded.
- `UNAUTHORIZED`: sign in again. Ensure the client ID used to sign in matches the deployed Worker's configuration.

References: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Chrome identity API](https://developer.chrome.com/docs/extensions/reference/api/identity).
