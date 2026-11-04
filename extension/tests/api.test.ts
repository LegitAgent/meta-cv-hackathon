import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL } from "../src/shared/config";
import { postSummary } from "../src/panel/api";
import type { SummaryRequestPayload } from "../src/shared/contracts";

function payload(): SummaryRequestPayload {
  return {
    requestId: "r-1",
    checkpoint: {
      id: "c-1",
      title: "t",
      pageText: "p",
      selectedText: "",
      code: null,
      language: null,
      screenshot: null,
      stuckPoint: null,
      quality: { code: "complete", missingFields: [], truncatedFields: [], warnings: [] },
    },
    notes: [],
  };
}

function mockSignedIn() {
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async () => ({
          backendCredential: {
            origin: new URL(BACKEND_URL).origin,
            token: "tok",
            email: "a@gmail.com",
            expiresAt: Date.now() + 3600000,
          },
        }),
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postSummary transport errors", () => {
  it("carries the Retry-After delay on 429 responses", async () => {
    mockSignedIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests. Retry in a minute." } }),
        { status: 429, headers: { "Retry-After": "60" } },
      )),
    );
    const err = (await postSummary(BACKEND_URL, payload()).catch((e) => e)) as Error & {
      code?: string;
      retryAfterSeconds?: number;
    };
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterSeconds).toBe(60);
  });

  it("falls back to the HTTP status when the error page is not JSON", async () => {
    mockSignedIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>proxy error</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      })),
    );
    const err = (await postSummary(BACKEND_URL, payload()).catch((e) => e)) as Error & { code?: string };
    expect(err.code).toBe("HTTP_502");
    expect(err.message).toContain("502");
  });
});
