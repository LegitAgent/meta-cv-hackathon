import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOWED_EXTENSION_ORIGINS: string;
}
export class AuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function verifyGoogleToken(token: string, env: AuthEnv, nonce?: string, keys: JWTVerifyGetKey = googleKeys) {
  if (!env.GOOGLE_CLIENT_ID) throw new AuthError(503, "AUTH_NOT_CONFIGURED", "Google sign-in is not configured.");
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.GOOGLE_CLIENT_ID, requiredClaims: ["sub", "exp", "iat", "email", "email_verified"],
    });
    if (payload.azp && payload.azp !== env.GOOGLE_CLIENT_ID) throw new Error("Wrong authorized party");
    if (nonce !== undefined && payload.nonce !== nonce) throw new Error("Wrong nonce");
    if (payload.email_verified !== true || typeof payload.email !== "string" || !/^[^@]+@gmail\.com$/i.test(payload.email))
      throw new AuthError(403, "GMAIL_REQUIRED", "Sign in with a verified @gmail.com account.");
    return { sub: payload.sub!, email: payload.email, expiresAt: payload.exp! * 1000 };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(401, "UNAUTHORIZED", "Sign in with Google again; your session is missing, invalid, or expired.");
  }
}

export async function exchangeGoogleCode(body: unknown, env: AuthEnv) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new AuthError(503, "AUTH_NOT_CONFIGURED", "Google sign-in is not configured.");
  const data = body as Record<string, unknown> | null;
  const redirects = (env.ALLOWED_EXTENSION_ORIGINS || "").split(",").map(s => s.trim())
    .filter(s => /^chrome-extension:\/\/[a-p]{32}$/.test(s))
    .map(s => `https://${s.slice("chrome-extension://".length)}.chromiumapp.org/`);
  if (!data || typeof data.code !== "string" || !data.code || data.code.length > 4096 ||
      typeof data.codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(data.codeVerifier) ||
      typeof data.nonce !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(data.nonce) ||
      typeof data.redirectUri !== "string" || !redirects.includes(data.redirectUri))
    throw new AuthError(400, "INVALID_AUTH_REQUEST", "Invalid sign-in request.");
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      // Workers supports manual/follow only. Non-2xx responses below reject redirects.
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: data.code, code_verifier: data.codeVerifier,
        redirect_uri: data.redirectUri, client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: "authorization_code" }),
    });
  } catch { throw new AuthError(503, "AUTH_UNAVAILABLE", "Google sign-in is temporarily unavailable."); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AuthError(401, "SIGN_IN_FAILED", "Google sign-in failed. Try again.");
  }
  const result = await response.json() as { id_token?: string };
  if (!result.id_token) throw new AuthError(401, "SIGN_IN_FAILED", "Google did not return an identity token.");
  const identity = await verifyGoogleToken(result.id_token, env, data.nonce);
  // Only the short-lived identity token is returned. No Google API access or refresh tokens are stored.
  return { token: result.id_token, email: identity.email, expiresAt: identity.expiresAt };
}
