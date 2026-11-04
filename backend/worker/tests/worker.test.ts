import { afterEach, describe, expect, it, vi } from "vitest";
import { BODY_LIMIT, createHandler, type Env } from "../src/index";

const token = "a".repeat(40);
const summary = { recap: "Saved attempt", observedFacts: [], possibleBlocker: null, nextAction: "Trace one input", uncertainties: [] };
const input = () => ({ requestId: "request-1", checkpoint: { id: "checkpoint-1", title: "Example", pageText: "A problem", code: "x = 1", quality: { code: "complete" } }, notes: [] });
function setup() {
  const stored = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (r: Request) => stored.get(r.url)?.clone()),
    put: vi.fn(async (r: Request, response: Response) => { stored.set(r.url, response.clone()); }),
  };
  const env: Env = {
    AI_API_KEY: "provider-secret", BACKTRACK_ACCESS_TOKEN: token,
    AI_BASE_URL: "https://provider.example/v1", AI_MODEL: "muse-test",
    ALLOWED_EXTENSION_ORIGINS: "chrome-extension://test", CACHE_TTL_SECONDS: "300",
    IP_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    TOKEN_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
  };
  const tasks: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => tasks.push(p) } as ExecutionContext;
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(summary) } }] })));
  vi.stubGlobal("fetch", fetcher);
  const handler = createHandler(cache as unknown as Cache);
  const send = (body: unknown = input(), headers: Record<string, string> = {}) => handler(new Request("https://api.example/api/v1/summaries", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: "chrome-extension://test", ...headers }, body: JSON.stringify(body),
  }), env, ctx);
  return { send, env, cache, tasks, fetcher, handler, ctx };
}
afterEach(() => vi.unstubAllGlobals());
describe("Worker gateway", () => {
  it("requires authentication before inference or cache access", async () => {
    const t = setup();
    expect((await t.send(input(), { Authorization: "Bearer wrong" })).status).toBe(401);
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.cache.match).not.toHaveBeenCalled();
  });
  it("fails closed when auth is not configured", async () => {
    const t = setup(); t.env.BACKTRACK_ACCESS_TOKEN = "";
    expect((await t.send()).status).toBe(503); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it("rejects unapproved origins and provides allowed preflight", async () => {
    const t = setup();
    expect((await t.send(input(), { Origin: "https://evil.example" })).status).toBe(403);
    const response = await t.handler(new Request("https://api.example/api/v1/summaries", { method: "OPTIONS", headers: { Origin: "chrome-extension://test" } }), t.env, t.ctx);
    expect(response.status).toBe(204); expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
  it("rate limits requests before provider calls", async () => {
    const t = setup(); vi.mocked(t.env.TOKEN_LIMITER.limit).mockResolvedValue({ success: false });
    const response = await t.send(); expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60"); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it("caps bodies without relying on Content-Length", async () => {
    const t = setup();
    expect((await t.send({ text: "x".repeat(BODY_LIMIT) })).status).toBe(413);
    expect(t.fetcher).not.toHaveBeenCalled();
  });
  it("validates aggregate note limits", async () => {
    const t = setup();
    const body = { ...input(), notes: [{ id: "1", body: "a".repeat(6000) }, { id: "2", body: "b".repeat(6000) }] };
    expect((await t.send(body)).status).toBe(422); expect(t.fetcher).not.toHaveBeenCalled();
  });
  it("reuses successful content while preserving new request and checkpoint IDs", async () => {
    const t = setup(); expect((await t.send()).headers.get("X-Backtrack-Cache")).toBe("MISS");
    await Promise.all(t.tasks);
    const body = input(); body.requestId = "new-request"; body.checkpoint.id = "new-checkpoint";
    const response = await t.send(body);
    expect(response.headers.get("X-Backtrack-Cache")).toBe("HIT");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ requestId: "new-request", checkpointId: "new-checkpoint" });
    expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it("isolates caches after credential, model or content changes", async () => {
    const t = setup(); await t.send(); await Promise.all(t.tasks);
    t.env.AI_MODEL = "different"; await t.send(); await Promise.all(t.tasks);
    t.env.BACKTRACK_ACCESS_TOKEN = "b".repeat(40); await t.send(input(), { Authorization: `Bearer ${t.env.BACKTRACK_ACCESS_TOKEN}` });
    await Promise.all(t.tasks);
    const changed = input(); changed.checkpoint.code = "x = 2";
    await t.send(changed, { Authorization: `Bearer ${t.env.BACKTRACK_ACCESS_TOKEN}` });
    expect(t.fetcher).toHaveBeenCalledTimes(4);
  });
  it("does not cache invalid model output or provider errors", async () => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response("provider failure", { status: 500 }));
    expect((await t.send()).status).toBe(502);
    t.fetcher.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] })));
    expect((await t.send()).status).toBe(502); expect(t.cache.put).not.toHaveBeenCalled();
  });
  it("can disable caching", async () => {
    const t = setup(); t.env.CACHE_TTL_SECONDS = "0";
    await t.send(); await t.send(); expect(t.fetcher).toHaveBeenCalledTimes(2);
    expect(t.cache.put).not.toHaveBeenCalled();
  });
  it("maps timeouts without leaking upstream details", async () => {
    const t = setup();
    t.fetcher.mockImplementation(async (_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener("abort", () => reject(new Error("secret")))));
    vi.useFakeTimers();
    try {
      // Hashing uses real async WebCrypto; start provider first, then advance its deadline.
      const responsePromise = t.send();
      await vi.waitFor(() => expect(t.fetcher).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(35001);
      const response = await responsePromise;
      expect(response.status).toBe(504); expect(await response.text()).not.toContain("secret");
    } finally { vi.useRealTimers(); }
  });
});
