"""pytest for the summary proxy: size bounds, schema validation,
upstream timeout/error mapping, and secret-free error text."""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main
import provider as provider_mod


def make_payload(**overrides):
    base = {
        "requestId": "r-1",
        "checkpoint": {
            "id": "c-1",
            "title": "Two Sum",
            "pageText": "problem text",
            "selectedText": "",
            "code": "x = 1",
            "language": "python",
            "quality": {"code": "complete", "missingFields": [], "truncatedFields": [], "warnings": []},
        },
        "notes": [{"id": "n-1", "body": "tried dict"}],
    }
    base.update(overrides)
    return base


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "baseten")
    monkeypatch.setenv("AI_BASE_URL", "https://inference.example.test/v1")
    monkeypatch.setenv("AI_MODEL", "meta-models/muse-spark-open-1026")
    monkeypatch.setenv("AI_API_KEY", "test-key-redacted")
    return TestClient(main.app)


def good_summary():
    return {
        "recap": "Saved attempt uses a dict.",
        "observedFacts": [{"text": "The code creates a dict.", "sourceFields": ["code"]}],
        "possibleBlocker": None,
        "nextAction": "Trace the loop with one small input.",
        "uncertainties": [],
    }


def test_health_reports_config_without_secrets(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["providerConfigured"] is True
    assert "test-key-redacted" not in res.text


def test_rejects_oversized_page_text(client):
    payload = make_payload()
    payload["checkpoint"]["pageText"] = "x" * 20001
    res = client.post("/api/v1/summaries", json=payload)
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "INVALID_INPUT"


def test_rejects_oversized_body(client):
    payload = make_payload()
    payload["checkpoint"]["pageText"] = "y" * (260 * 1024)
    import json as _json

    res = client.post(
        "/api/v1/summaries",
        content=_json.dumps(payload),
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "BODY_TOO_LARGE"


def test_rejects_notes_aggregate_over_limit(client):
    payload = make_payload()
    payload["notes"] = [{"id": "a", "body": "z" * 6000}, {"id": "b", "body": "z" * 5000}]
    res = client.post("/api/v1/summaries", json=payload)
    assert res.status_code == 422


def test_missing_configuration_maps_to_503(monkeypatch):
    monkeypatch.delenv("AI_API_KEY", raising=False)
    c = TestClient(main.app)
    res = c.post("/api/v1/summaries", json=make_payload())
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "PROVIDER_NOT_CONFIGURED"


def test_success_path_returns_validated_summary(client, monkeypatch):
    async def fake_complete(system_prompt, user_prompt, config):
        assert "Two Sum" in user_prompt
        return good_summary(), "meta-models/muse-spark-open-1026", 0.1

    monkeypatch.setattr(main, "complete_summary", fake_complete)
    res = client.post("/api/v1/summaries", json=make_payload())
    assert res.status_code == 200
    body = res.json()
    assert body["requestId"] == "r-1"
    assert body["checkpointId"] == "c-1"
    assert body["summary"]["nextAction"].startswith("Trace")


def test_upstream_timeout_maps_to_504_without_secret_leak(client, monkeypatch):
    async def fake_complete(system_prompt, user_prompt, config):
        raise provider_mod.ProviderError("UPSTREAM_TIMEOUT", "Model request timed out.", retryable=True)

    monkeypatch.setattr(main, "complete_summary", fake_complete)
    res = client.post("/api/v1/summaries", json=make_payload())
    assert res.status_code == 504
    assert res.json()["error"]["code"] == "UPSTREAM_TIMEOUT"
    assert "test-key-redacted" not in res.text


def test_rate_limit_maps_to_429(client, monkeypatch):
    async def fake_complete(system_prompt, user_prompt, config):
        raise provider_mod.ProviderError("RATE_LIMITED", "Model rate limit reached.", retryable=True)

    monkeypatch.setattr(main, "complete_summary", fake_complete)
    res = client.post("/api/v1/summaries", json=make_payload())
    assert res.status_code == 429


def test_invalid_model_output_maps_to_502(client, monkeypatch):
    async def fake_complete(system_prompt, user_prompt, config):
        return {"recap": "", "observedFacts": [], "possibleBlocker": None, "nextAction": "", "uncertainties": []}, "m", 0.1

    monkeypatch.setattr(main, "complete_summary", fake_complete)
    res = client.post("/api/v1/summaries", json=make_payload())
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "MODEL_OUTPUT_INVALID"
