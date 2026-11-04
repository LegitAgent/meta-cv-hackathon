import { afterEach, describe, expect, it, vi } from "vitest";
import { BODY_LIMIT, createHandler, type Env } from "../src/index";
import { summaryResponseFormat } from "../src/schemas";

vi.mock("../src/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth")>();
  return { ...actual, verifyGoogleToken: vi.fn(async (token: string, env: Env) => {
    if (!env.GOOGLE_CLIENT_ID) throw new actual.AuthError(503, "AUTH_NOT_CONFIGURED", "Not configured");
    if (token !== "a".repeat(40) && token !== "b".repeat(40)) throw new actual.AuthError(401, "UNAUTHORIZED", "Sign in");
    return { sub: token, email: "test@gmail.com", expiresAt: Date.now() + 3600000 };
  }) };
});

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
    AI_API_KEY: "provider-secret", GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret",
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
  it("requests a complete structured summary with a reasoning-aware output budget", async () => {
    const t = setup();
    expect((await t.send()).status).toBe(200);
    const body = JSON.parse(t.fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ response_format: summaryResponseFormat, max_tokens: 4096, reasoning_effort: "low" });
    const schema = body.response_format.json_schema.schema;
    expect(schema.required).toEqual(expect.arrayContaining(["recap", "observedFacts", "possibleBlocker", "nextAction", "uncertainties"]));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.observedFacts.items.additionalProperties).toBe(false);
  });
  it.each(["", JSON.stringify(summary)])("rejects truncated output even when its content parses", async content => {
    const t = setup();
    t.fetcher.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content } }] })));
    const response = await t.send();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "MODEL_OUTPUT_TRUNCATED" } });
    expect(t.cache.put).not.toHaveBeenCalled(); expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { finish_reason: "content_filter", message: { content: null } },
    { finish_reason: "stop", message: { content: null, refusal: "private refusal text" } },
  ])("reports refusals without leaking provider text", async choice => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify({ choices: [choice] })));
    const response = await t.send();
    expect(await response.json()).toMatchObject({ error: { code: "MODEL_REFUSED", retryable: false } });
    expect(t.cache.put).not.toHaveBeenCalled();
  });
  it.each([null, "", "```json\n{}\n```", "{\"recap\":", {}])("rejects missing or malformed summary content: %j", async content => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] })));
    expect((await t.send()).status).toBe(502); expect(t.cache.put).not.toHaveBeenCalled();
  });
  it("rejects provider redirects without forwarding credentials", async () => {
    const t = setup();
    t.fetcher.mockImplementation(async (_url, options) => {
      if (options.redirect === "error") throw new TypeError("Invalid redirect value");
      return new Response(null, { status: 302, headers: { Location: "https://other.example/" } });
    });
    expect((await t.send()).status).toBe(502);
    expect(t.fetcher).toHaveBeenCalledTimes(1);
    expect(t.fetcher.mock.calls[0][1].redirect).toBe("manual");
    expect(t.cache.put).not.toHaveBeenCalled();
  });
  it("requires authentication before inference or cache access", async () => {
    const t = setup();
    expect((await t.send(input(), { Authorization: "Bearer wrong" })).status).toBe(401);
    expect(t.fetcher).not.toHaveBeenCalled(); expect(t.cache.match).not.toHaveBeenCalled();
  });
  it("tolerates extra whitespace after the Bearer scheme", async () => {
    const t = setup();
    const response = await t.send(input(), { Authorization: `Bearer  ${token}` });
    expect(response.status).toBe(200);
    expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it("accepts a lowercase bearer scheme", async () => {
    const t = setup();
    const response = await t.send(input(), { Authorization: `bearer ${token}` });
    expect(response.status).toBe(200);
    expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects screenshots that are not data URLs", async () => {
    const t = setup();
    const body = { ...input(), checkpoint: { ...input().checkpoint, screenshot: "https://evil.example/shot.png" } };
    const response = await t.send(body);
    expect(response.status).toBe(422);
    expect(t.fetcher).not.toHaveBeenCalled();
  });
  it("shares cache between trailing-slash base URL variants", async () => {
    const t = setup();
    expect((await t.send()).headers.get("X-Backtrack-Cache")).toBe("MISS");
    await Promise.all(t.tasks);
    t.env.AI_BASE_URL = "https://provider.example/v1/";
    const response = await t.send(input());
    expect(response.headers.get("X-Backtrack-Cache")).toBe("HIT");
    expect(t.fetcher).toHaveBeenCalledTimes(1);
  });
  it("maps an aborted oversized provider stream to timeout", async () => {
    const t = setup();
    t.fetcher.mockImplementation(() => new Promise(res => setTimeout(() => res(new Response("x".repeat(BODY_LIMIT + 1))), 40000)));
    vi.useFakeTimers();
    try {
      const responsePromise = t.send();
      await vi.waitFor(() => expect(t.fetcher).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(35001);
      await vi.advanceTimersByTimeAsync(5000);
      const response = await responsePromise;
      expect(response.status).toBe(504);
      expect(await response.json()).toMatchObject({ error: { code: "UPSTREAM_TIMEOUT" } });
    } finally { vi.useRealTimers(); }
  });
  it("sends the screenshot as an image part alongside the text", async () => {
    const t = setup();
    const shot = `data:image/jpeg;base64,${"a".repeat(1000)}`;
    const body = { ...input(), checkpoint: { ...input().checkpoint, screenshot: shot } };
    const response = await t.send(body);
    expect(response.status).toBe(200);
    const sent = JSON.parse(t.fetcher.mock.calls[0][1].body);
    expect(sent.messages[1].content).toEqual([
      { type: "text", text: expect.any(String) },
      { type: "image_url", image_url: { url: shot } },
    ]);
    expect(sent.messages[1].content[0].text).not.toContain("data:image");
  });
  it("appends the stuck point to the provider text", async () => {
    const t = setup();
    const body = { ...input(), checkpoint: { ...input().checkpoint, stuckPoint: "loop logic" } };
    expect((await t.send(body)).status).toBe(200);
    const sent = JSON.parse(t.fetcher.mock.calls[0][1].body);
    const content = sent.messages[1].content;
    const text = typeof content === "string" ? content : content[0].text;
    expect(text).toContain("User stuck point: loop logic");
  });
  it("fails closed when auth is not configured", async () => {
    const t = setup(); t.env.GOOGLE_CLIENT_ID = "";
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
    const secondToken = "b".repeat(40); await t.send(input(), { Authorization: `Bearer ${secondToken}` });
    await Promise.all(t.tasks);
    const changed = input(); changed.checkpoint.code = "x = 2";
    await t.send(changed, { Authorization: `Bearer ${secondToken}` });
    expect(t.fetcher).toHaveBeenCalledTimes(4);
  });
  it("does not cache invalid model output or provider errors", async () => {
    const t = setup(); t.fetcher.mockResolvedValue(new Response("provider failure", { status: 500 }));
    expect((await t.send()).status).toBe(502);
    t.fetcher.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] })));
    expect((await t.send()).status).toBe(502); expect(t.cache.put).not.toHaveBeenCalled();
  });
  it("repairs fenced and slightly overlong model output instead of failing", async () => {
    const t = setup();
    const payload = {
      recap: "r".repeat(1300),
      observedFacts: [{ text: "  fact  ", sourceFields: "code" }, { text: "", sourceFields: [] }],
      possibleBlocker: "",
      nextAction: " Trace one input ",
      uncertainties: ["", 42, "u"],
    };
    t.fetcher.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "```json\n" + JSON.stringify(payload) + "\n```" } }] })));
    const response = await t.send();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary.recap).toHaveLength(1200);
    expect(body.summary.observedFacts).toEqual([{ text: "fact", sourceFields: ["code"] }]);
    expect(body.summary.possibleBlocker).toBeNull();
    expect(body.summary.nextAction).toBe("Trace one input");
    expect(body.summary.uncertainties).toEqual(["u"]);
  });
  it("still rejects model output missing core content", async () => {
    const t = setup();
    t.fetcher.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ recap: "", nextAction: "" }) } }] })));
    expect((await t.send()).status).toBe(502);
    expect(t.cache.put).not.toHaveBeenCalled();
  });
  it("tells the model what to say when there is nothing to recap", async () => {
    const t = setup();
    expect((await t.send()).status).toBe(200);
    const body = JSON.parse(t.fetcher.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("didn't add anything");
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
