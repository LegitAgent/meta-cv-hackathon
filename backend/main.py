"""Backtrack summary proxy (FastAPI). Demo bind: 127.0.0.1:8001.

Separate from the camera prototype in app.py: this service stores no
notes or checkpoint database and loads no YOLO weights.

- GET /health: status + provider-configured boolean (no secrets).
- POST /api/v1/summaries: 256 KiB body cap before JSON parsing,
  Pydantic validation, 35s upstream timeout, no retries.
- Error envelope: {error: {code, message, retryable}}.
"""

from __future__ import annotations

import logging
import os
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from prompts import SYSTEM_PROMPT, build_user_prompt
from provider import ProviderConfig, ProviderError, complete_summary, is_configured
from schemas import Summary, SummaryRequest

BODY_BYTES_MAX = 256 * 1024

log = logging.getLogger("backtrack")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Backtrack summary proxy", version="0.1.0")

allowed_origin = os.environ.get("ALLOWED_EXTENSION_ORIGIN", "").strip()
# CORS only for the development extension origin where needed;
# CORS is not authentication.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[allowed_origin] if allowed_origin else [],
    allow_methods=["GET", "POST"],
    allow_headers=["content-type"],
)


def err(code: str, message: str, retryable: bool, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "retryable": retryable}})


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "providerConfigured": is_configured()}


@app.post("/api/v1/summaries")
async def create_summary(request: Request):
    started = time.monotonic()
    request_id = "unknown"
    # Enforce the body cap before JSON parsing.
    length = request.headers.get("content-length")
    if length is not None:
        try:
            if int(length) > BODY_BYTES_MAX:
                return err("BODY_TOO_LARGE", "Request body exceeds 256 KiB.", False, 413)
        except ValueError:
            pass
    raw = await request.body()
    if len(raw) > BODY_BYTES_MAX:
        return err("BODY_TOO_LARGE", "Request body exceeds 256 KiB.", False, 413)
    try:
        payload = SummaryRequest.model_validate_json(raw)
    except ValidationError as e:
        return err("INVALID_INPUT", f"Request failed validation: {e.errors(include_url=False)[0]['msg']}", False, 422)
    except ValueError:
        return err("INVALID_INPUT", "Request body is not valid JSON.", False, 422)
    request_id = payload.requestId

    config = ProviderConfig.from_env()
    if config is None:
        return err("PROVIDER_NOT_CONFIGURED", "AI provider is not configured on this server.", False, 503)

    user_prompt = build_user_prompt(
        title=payload.checkpoint.title,
        page_text=payload.checkpoint.pageText,
        selected_text=payload.checkpoint.selectedText,
        code=payload.checkpoint.code,
        language=payload.checkpoint.language,
        notes=[n.body for n in payload.notes],
        quality_code=payload.checkpoint.quality.code,
        missing=list(payload.checkpoint.quality.missingFields),
    )
    try:
        parsed, model, upstream_s = await complete_summary(SYSTEM_PROMPT, user_prompt, config)
    except ProviderError as e:
        # Sanitize upstream errors: code + retryable only.
        log.info("summary requestId=%s failed code=%s", request_id, e.code)
        mapping = {
            "UPSTREAM_TIMEOUT": (504, True),
            "RATE_LIMITED": (429, True),
            "MODEL_OUTPUT_INVALID": (502, True),
            "PROVIDER_ERROR": (502, True),
            "PROVIDER_NOT_CONFIGURED": (503, False),
        }
        status, retryable = mapping.get(e.code, (502, True))
        return err(e.code, str(e), retryable if not isinstance(e.retryable, bool) else e.retryable, status)
    try:
        summary = Summary.model_validate(parsed)
    except ValidationError:
        log.info("summary requestId=%s invalid model output", request_id)
        return err("MODEL_OUTPUT_INVALID", "Model returned output that failed validation. Retry the request.", True, 502)

    elapsed = time.monotonic() - started
    log.info("summary requestId=%s ok model=%s upstream_s=%.2f total_s=%.2f", request_id, model, upstream_s, elapsed)
    return {"requestId": request_id, "checkpointId": payload.checkpoint.id, "summary": summary.model_dump(), "model": model}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8001)
