import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyGoogleToken, exchangeGoogleCode } from "../src/auth";

const env = { GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "secret",
  ALLOWED_EXTENSION_ORIGINS: "chrome-extension://icmegjccphakockngdmbdbkfehdpfcfa" };
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test", alg: "RS256" }] });
});
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ sub: "google-user-123", email: "person@gmail.com", email_verified: true,
    iss: "https://accounts.google.com", aud: env.GOOGLE_CLIENT_ID, iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, nonce: "nonce", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(pair.privateKey);
}
afterEach(() => vi.unstubAllGlobals());
describe("Google identity verification", () => {
  it("accepts a signed Gmail identity and returns its stable subject", async () => {
    expect(await verifyGoogleToken(await token(), env, "nonce", keys)).toMatchObject({ sub: "google-user-123", email: "person@gmail.com" });
  });
  it.each([{ aud: "another-client" }, { iss: "https://evil.example" }, { exp: 1 }, { azp: "another-client" }, { sub: undefined }])("rejects invalid claims %j", async claims => {
    await expect(verifyGoogleToken(await token(claims), env, undefined, keys)).rejects.toMatchObject({ status: 401 });
  });
  it.each([{ email: "person@company.com" }, { email: "person@gmail.com.evil.example" }, { email_verified: false }])("rejects non-Gmail or unverified identities %j", async claims => {
    await expect(verifyGoogleToken(await token(claims), env, undefined, keys)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects a mismatched nonce and forged signature", async () => {
    await expect(verifyGoogleToken(await token(), env, "wrong", keys)).rejects.toMatchObject({ status: 401 });
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(other.privateKey);
    await expect(verifyGoogleToken(forged, env, undefined, keys)).rejects.toMatchObject({ status: 401 });
  });
  it("rejects missing configuration", async () => {
    await expect(verifyGoogleToken("", { ...env, GOOGLE_CLIENT_ID: "" }, undefined, keys)).rejects.toMatchObject({ status: 503 });
  });
  it("rejects arbitrary redirect URLs and malformed verifiers before contacting Google", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const request = { code: "code", codeVerifier: "v".repeat(43), nonce: "n".repeat(43), redirectUri: "https://evil.example/" };
    await expect(exchangeGoogleCode(request, env)).rejects.toMatchObject({ status: 400 });
    await expect(exchangeGoogleCode({ ...request, redirectUri: "https://icmegjccphakockngdmbdbkfehdpfcfa.chromiumapp.org/", codeVerifier: "short" }, env)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([302, 400])("uses Workers-compatible redirect handling and rejects upstream status %s", async status => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      // Match the Workers runtime restriction that Node's fetch mock otherwise misses.
      if (options.redirect === "error") throw new TypeError("Invalid redirect value");
      return new Response("private diagnostic", { status, headers: { Location: "https://other.example/" } });
    }); vi.stubGlobal("fetch", fetcher);
    await expect(exchangeGoogleCode({ code: "code", codeVerifier: "v".repeat(43), nonce: "n".repeat(43),
      redirectUri: "https://icmegjccphakockngdmbdbkfehdpfcfa.chromiumapp.org/" }, env)).rejects.toMatchObject({ status: 401, message: "Google sign-in failed. Try again." });
    expect(fetcher.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
