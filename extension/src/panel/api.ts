// Panel-side API client. The panel owns the live note draft and executes
// AI HTTP requests while open, with a 45s AbortController deadline.
// Only the explicitly selected checkpoint is ever sent to the backend.

import { backendSummaryResponseSchema, type BackendSummaryResponse } from "../shared/validation";
import type { SummaryRequestPayload } from "../shared/contracts";
import { getCredential } from "./auth";

export const PANEL_FETCH_TIMEOUT_MS = 45_000;

export async function postSummary(
  backendUrl: string,
  payload: SummaryRequestPayload,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<BackendSummaryResponse> {
  if (opts?.signal?.aborted)
    throw Object.assign(new Error("Summary request was cancelled before sending."), { code: "ABORTED" });
  const timeoutMs = opts?.timeoutMs ?? PANEL_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("TIMEOUT")), timeoutMs);
  const onExternalAbort = () => controller.abort(opts?.signal?.reason ?? new Error("ABORTED"));
  opts?.signal?.addEventListener("abort", onExternalAbort, { once: true });
  try {
    const credential = await getCredential(new URL(backendUrl).origin);
    if (!credential) throw Object.assign(new Error("Sign in with Google under Account to generate a recap."), { code: "UNAUTHORIZED" });
    const authorization = { Authorization: `Bearer ${credential.token}` };
    const res = await fetch(`${backendUrl.replace(/\/$/, "")}/api/v1/summaries`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authorization },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      let code = `HTTP_${res.status}`;
      let message = `Request failed with status ${res.status}.`;
      try {
        const err = (await res.json()) as { error?: { code?: string; message?: string } };
        if (err?.error?.code) code = err.error.code;
        if (err?.error?.message) message = err.error.message;
      } catch {
        // Keep the default message.
      }
      const thrown = Object.assign(new Error(message), { code }) as Error & {
        code: string;
        retryAfterSeconds?: number;
      };
      if (res.status === 429) {
        const wait = Number(res.headers.get("Retry-After"));
        if (Number.isFinite(wait) && wait >= 0) thrown.retryAfterSeconds = Math.floor(wait);
      }
      throw thrown;
    }
    const json: unknown = await res.json();
    const parsed = backendSummaryResponseSchema.safeParse(json);
    if (!parsed.success) throw Object.assign(new Error("Backend response failed validation."), { code: "MODEL_OUTPUT_INVALID" });
    return parsed.data;
  } catch (e) {
    if (e instanceof Error && (e.name === "AbortError" || /TIMEOUT|ABORTED/.test(e.message))) {
      throw Object.assign(new Error(`Summary request timed out after ${Math.round(timeoutMs / 1000)}s. The checkpoint is saved; retry when ready.`), {
        code: "TIMEOUT",
      });
    }
    throw e;
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function getHealth(
  backendUrl: string,
  opts?: { timeoutMs?: number },
): Promise<{ status: string; providerConfigured: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("TIMEOUT")), opts?.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${backendUrl.replace(/\/$/, "")}/health`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Backend health check failed (${res.status}).`);
    return (await res.json()) as { status: string; providerConfigured: boolean };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError")
      throw new Error("Backend health check timed out.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
