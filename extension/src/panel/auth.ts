export interface Credential { origin: string; token: string; email: string; expiresAt: number }
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function getCredential(origin: string): Promise<Credential | null> {
  const { backendCredential } = await chrome.storage.session.get("backendCredential");
  return backendCredential?.origin === origin && typeof backendCredential.token === "string" &&
    typeof backendCredential.email === "string" && backendCredential.expiresAt > Date.now() + 30000
    ? backendCredential as Credential : null;
}
async function responseJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Sign-in failed. Try again.");
  return data;
}
export async function signIn(origin: string): Promise<Credential> {
  const config = await responseJson(await fetch(`${origin}/auth/config`, { signal: AbortSignal.timeout(15000) }));
  if (typeof config.clientId !== "string" || !config.clientId.endsWith(".apps.googleusercontent.com"))
    throw new Error("Google sign-in is not configured on this backend.");
  const state = random(), nonce = random(), codeVerifier = random();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))));
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri,
    response_type: "code", scope: "openid email", state, nonce,
    code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" }).toString();
  const result = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  if (!result) throw new Error("Sign-in was cancelled.");
  const callback = new URL(result), expected = new URL(redirectUri);
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.searchParams.get("state") !== state)
    throw new Error("Sign-in response could not be verified. Try again.");
  const code = callback.searchParams.get("code");
  if (callback.searchParams.has("error") || !code) throw new Error("Google sign-in was cancelled or denied.");
  const data = await responseJson(await fetch(`${origin}/auth/google`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ code, codeVerifier, redirectUri, nonce }),
  }));
  if (typeof data.token !== "string" || typeof data.email !== "string" || !/^[^@]+@gmail\.com$/i.test(data.email) ||
      typeof data.expiresAt !== "number" || data.expiresAt <= Date.now()) throw new Error("Invalid sign-in response.");
  const credential: Credential = { origin, token: data.token, email: data.email, expiresAt: data.expiresAt };
  await chrome.storage.session.set({ backendCredential: credential });
  return credential;
}
export async function signOut() { await chrome.storage.session.remove("backendCredential"); }
