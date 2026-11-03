"""Model provider client. One verified provider behind env config.

Reads AI_PROVIDER / AI_BASE_URL / AI_MODEL / AI_API_KEY from the
environment. The initial integration target is Baseten
(meta-models/muse-spark-open-1026); endpoint, auth, and model access
must be verified with a minimal server-side request before integration
(verify-before-integrate). Do not assume other providers accept the
same model name or API shape.

Upstream timeout is 35s (below the panel's 45s deadline). No automatic
retries in the first build.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass

import httpx

UPSTREAM_TIMEOUT_S = 35.0


@dataclass
class ProviderConfig:
    provider: str
    base_url: str
    model: str
    api_key: str

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "ProviderConfig | None":
        src = env if env is not None else os.environ
        api_key = (src.get("AI_API_KEY") or "").strip()
        if not api_key:
            return None
        return cls(
            provider=(src.get("AI_PROVIDER") or "baseten").strip().lower(),
            base_url=(src.get("AI_BASE_URL") or "").strip().rstrip("/"),
            model=(src.get("AI_MODEL") or "meta-models/muse-spark-open-1026").strip(),
            api_key=api_key,
        )


class ProviderError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def is_configured(env: dict[str, str] | None = None) -> bool:
    return ProviderConfig.from_env(env) is not None


async def complete_summary(
    system_prompt: str,
    user_prompt: str,
    config: ProviderConfig,
    client: httpx.AsyncClient | None = None,
) -> tuple[dict, str, float]:
    """Call the provider chat-completions interface. Returns (parsed_json, model, seconds)."""
    if not config.base_url:
        raise ProviderError("PROVIDER_NOT_CONFIGURED", "AI_BASE_URL is not set.", retryable=False)
    url = f"{config.base_url}/chat/completions"
    payload = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 1200,
    }
    headers = {"authorization": f"Bearer {config.api_key}", "content-type": "application/json"}
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT_S)
    started = time.monotonic()
    try:
        resp = await http.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as e:
        raise ProviderError("UPSTREAM_TIMEOUT", "Model request timed out.", retryable=True) from e
    except httpx.HTTPError as e:
        raise ProviderError("PROVIDER_ERROR", "Model provider unreachable.", retryable=True) from e
    finally:
        if own_client:
            await http.aclose()
    elapsed = time.monotonic() - started
    if resp.status_code == 429:
        raise ProviderError("RATE_LIMITED", "Model rate limit reached.", retryable=True)
    if resp.status_code >= 400:
        raise ProviderError("PROVIDER_ERROR", f"Model provider error ({resp.status_code}).", retryable=resp.status_code >= 500)
    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content) if isinstance(content, str) else content
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise ProviderError("MODEL_OUTPUT_INVALID", "Model returned unparseable output.", retryable=True) from e
    if not isinstance(parsed, dict):
        raise ProviderError("MODEL_OUTPUT_INVALID", "Model returned unparseable output.", retryable=True)
    return parsed, config.model, elapsed
