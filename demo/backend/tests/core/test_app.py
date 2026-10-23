"""App shell: routers mounted, health, CORS, loopback-only defaults."""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.core.limiter import RateLimiter
from app.core.masking import Masker
from tests.support import Clock, Upstream, make_app, ok_body


def test_showcase_pings(qdir):
    app, _ = make_app(Upstream((200, ok_body([]))), queries_dir=qdir)
    with TestClient(app) as c:
        for sc in ("ac1", "ac2", "ac8", "metrics", "ac4"):
            r = c.get(f"/api/{sc}/ping")
            assert r.status_code == 200 and r.json() == {"showcase": sc, "ok": True}


def test_health_reports_state_without_token(qdir):
    up = Upstream((200, ok_body([{"[n]": 1}])))
    app, _ = make_app(up, queries_dir=qdir, limiter=RateLimiter(per_minute=55, clock=Clock()))
    with TestClient(app) as c:
        c.get("/api/ac1/q/data_as_of", params={"env": "PROD"})
        h = c.get("/api/health").json()
    assert h["real"] is False and h["mode"] == "masked"
    assert h["limit_per_minute"] == 55 and h["calls_total"] == 1 and h["calls_peak_per_minute"] == 1
    assert h["cache_entries"] == 1 and h["token_expires_in_s"] > 0
    # >= the eleven of D0 + AC-4 + AC-10: a count broke with every new model (core request ac4 #2 / ac7 #1)
    assert len(h["datasets"]) >= 11 and h["queries"]["ac1"] >= 1
    assert "tok1" not in json.dumps(h)


def test_health_shows_real_as_boolean(qdir):
    app, _ = make_app(Upstream((200, ok_body([]))), queries_dir=qdir, masker=Masker(real=True))
    with TestClient(app) as c:
        h = c.get("/api/health").json()
    assert h["real"] is True and h["mode"] == "real"


def test_cors_localhost_4200_to_4204_only(qdir):
    app, _ = make_app(Upstream((200, ok_body([]))), queries_dir=qdir)
    with TestClient(app) as c:
        for port in (4200, 4201, 4202, 4203, 4204):
            o = f"http://localhost:{port}"
            assert c.get("/api/health", headers={"Origin": o}).headers.get("access-control-allow-origin") == o
        for o in ("http://localhost:4205", "http://evil.example", "http://127.0.0.1:4200"):
            assert "access-control-allow-origin" not in c.get("/api/health", headers={"Origin": o}).headers


def test_only_get_routes(qdir):
    app, _ = make_app(Upstream((200, ok_body([]))), queries_dir=qdir)
    with TestClient(app) as c:
        assert c.post("/api/ac1/q/data_as_of", params={"env": "PROD"}).status_code == 405
