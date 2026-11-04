import { afterEach, describe, expect, it, vi } from "vitest";
import { getCredential, signIn, signOut } from "../src/panel/auth";
const origin = "https://backend.example";
const redirect = "https://icmegjccphakockngdmbdbkfehdpfcfa.chromiumapp.org/";
function setup(mode = "ok") {
  const session: Record<string, unknown> = {};
  const set = vi.fn(async (data: object) => Object.assign(session, data));
  const launch = vi.fn(async ({ url }: { url: string }) => {
    const auth = new URL(url);
    expect(auth.searchParams.get("scope")).toBe("openid email");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    return `${mode === "redirect" ? "https://evil.example/" : redirect}?code=code&state=${mode === "state" ? "wrong" : auth.searchParams.get("state")}`;
  });
  vi.stubGlobal("chrome", { identity: { getRedirectURL: () => redirect, launchWebAuthFlow: launch },
    storage: { session: { get: async () => session, set, remove: async () => { delete session.backendCredential; } } } });
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/auth/config")
    ? { clientId: "client.apps.googleusercontent.com" }
    : { token: "signed-token", email: "user@gmail.com", expiresAt: Date.now() + 3600000 })));
  vi.stubGlobal("fetch", fetcher);
  return { session, set, launch, fetcher };
}
afterEach(() => vi.unstubAllGlobals());
describe("extension Google sign-in", () => {
  it("stores an origin-scoped session and clears it on sign-out", async () => {
    setup(); await signIn(origin);
    expect(await getCredential(origin)).toMatchObject({ email: "user@gmail.com" });
    expect(await getCredential("https://other.example")).toBeNull();
    await signOut(); expect(await getCredential(origin)).toBeNull();
  });
  it.each(["state", "redirect"])("rejects mismatched %s before exchanging a code", async mode => {
    const t = setup(mode); await expect(signIn(origin)).rejects.toThrow("could not be verified");
    expect(t.fetcher).toHaveBeenCalledTimes(1); expect(t.set).not.toHaveBeenCalled();
  });
  it("does not accept expired sessions or old shared-token credentials", async () => {
    const t = setup();
    t.session.backendCredential = { origin, token: "old-shared-token" };
    expect(await getCredential(origin)).toBeNull();
    t.session.backendCredential = { origin, token: "expired", email: "user@gmail.com", expiresAt: Date.now() - 1 };
    expect(await getCredential(origin)).toBeNull();
  });
  it("handles cancelled sign-in without storing credentials", async () => {
    const t = setup(); t.launch.mockRejectedValue(new Error("User cancelled"));
    await expect(signIn(origin)).rejects.toThrow("cancelled"); expect(t.set).not.toHaveBeenCalled();
  });
});
