"""HTTP contract: /health, errors, 501s for missing packages, body limit, CORS."""

from __future__ import annotations

from fastapi.testclient import TestClient

from warqa_worker import ocr
from warqa_worker.app import create_app

from .conftest import b64, tiny_png, tiny_wav


def test_health_with_core_deps_only(client, no_engines):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["version"] == "0.1.0"
    assert body["capabilities"] == {"ocr": [], "align": [], "tashkeel": [], "tts": []}


def test_health_reports_whatever_is_installed(client):
    res = client.get("/health")
    assert res.status_code == 200
    caps = res.json()["capabilities"]
    assert set(caps) == {"ocr", "align", "tashkeel", "tts"}
    assert all(isinstance(v, list) for v in caps.values())


def test_ocr_501_without_engines(client, no_engines):
    res = client.post("/ocr", json={"image_base64": b64(tiny_png()), "lang": "ar"})
    assert res.status_code == 501
    assert "ocr" in res.json()["error"].lower()


def test_align_501_without_stable_ts(client, no_engines):
    res = client.post("/align", json={"audio_base64": b64(tiny_wav()), "text": "مرحبا بكم", "lang": "ar"})
    assert res.status_code == 501
    assert "stable-ts" in res.json()["error"]


def test_tashkeel_501_without_catt(client, no_engines):
    res = client.post("/tashkeel", json={"text": "ذهب الولد"})
    assert res.status_code == 501
    assert "catt" in res.json()["error"].lower()


def test_tts_501_without_engines(client, no_engines):
    res = client.post("/tts", json={"text": "مرحبا", "voice": "ar_JO-kareem-medium", "lang": "ar", "rate": None})
    assert res.status_code == 501
    assert "error" in res.json()


def test_bad_base64_is_400(client, no_engines):
    for path, body in (
        ("/ocr", {"image_base64": "!!! not base64 !!!", "lang": "ar"}),
        ("/align", {"audio_base64": "%%%", "text": "نص", "lang": "ar"}),
    ):
        res = client.post(path, json=body)
        assert res.status_code == 400, path
        assert "base64" in res.json()["error"]


def test_bad_base64_is_400_even_with_engines_installed(client):
    res = client.post("/ocr", json={"image_base64": "@@@@", "lang": "ar"})
    assert res.status_code == 400


def test_align_rejects_non_audio(client, no_engines):
    res = client.post("/align", json={"audio_base64": b64(b"hello, not audio"), "text": "نص", "lang": "ar"})
    assert res.status_code == 400
    assert "mp3 or wav" in res.json()["error"]


def test_missing_field_is_400_not_422(client):
    res = client.post("/ocr", json={"lang": "ar"})
    assert res.status_code == 400
    assert "image_base64" in res.json()["error"]


def test_malformed_json_is_400(client):
    res = client.post("/tashkeel", content=b"{not json", headers={"content-type": "application/json"})
    assert res.status_code == 400
    assert "error" in res.json()


def test_unknown_route_is_json_404(client):
    res = client.get("/nope")
    assert res.status_code == 404
    assert res.json() == {"error": "Not Found"}


def test_unexpected_errors_are_json_500(monkeypatch):
    def boom(image, lang):
        raise RuntimeError("boom")

    monkeypatch.setattr(ocr, "ocr", boom)
    client = TestClient(create_app(), raise_server_exceptions=False)
    res = client.post("/ocr", json={"image_base64": b64(tiny_png()), "lang": "ar"})
    assert res.status_code == 500
    assert res.json() == {"error": "RuntimeError: boom"}


def test_body_limit_is_413():
    client = TestClient(create_app(max_bytes=1000))
    res = client.post("/tashkeel", json={"text": "ا" * 2000})
    assert res.status_code == 413
    assert "too large" in res.json()["error"]


def test_body_limit_allows_normal_requests(no_engines):
    client = TestClient(create_app(max_bytes=10_000))
    res = client.post("/tashkeel", json={"text": "نص قصير"})
    assert res.status_code == 501  # passed the limit, then no engine


def test_cors_allows_localhost_only(client):
    ok = client.options("/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    res = client.get("/health", headers={"Origin": "http://127.0.0.1:4173"})
    assert res.headers.get("access-control-allow-origin") == "http://127.0.0.1:4173"
    bad = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


class FakeOcr:
    name = "fake"

    def available(self):
        return True

    def supports(self, lang):
        return lang.startswith("ar")

    def run(self, image, lang):
        return "مرحبا"


def test_ocr_route_uses_first_capable_engine(client, monkeypatch):
    monkeypatch.setattr(ocr, "ENGINES", {"tesseract": FakeOcr()})
    res = client.post("/ocr", json={"image_base64": b64(tiny_png()), "lang": "ar-MA"})
    assert res.status_code == 200, res.text
    assert res.json() == {"text": "مرحبا", "engine": "tesseract"}
    res = client.post("/ocr", json={"image_base64": b64(tiny_png()), "lang": "fr"})
    assert res.status_code == 501
