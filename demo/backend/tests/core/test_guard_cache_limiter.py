"""Guard, key normalisation, cache, token, limiter - copied from the metrics / AC-2 backend tests, run
against the core with a fixture queries tree (tests/core/conftest.py)."""
from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.core import datasets as D
from app.core.dax_client import ROW_WARN, DaxError, Token, TokenCache, normalise_keys, parse_response, scrub_message
from app.core.limiter import DEFAULT_PER_MINUTE, MAX_PER_MINUTE, RateLimited, RateLimiter, per_minute_from_env
from tests.support import Clock, Upstream, make_app, make_client, ok_body

RTS = {"env": "PROD"}


# ----------------------------------------------------------------------- response guard

@pytest.mark.parametrize("body", [
    {"error": {"code": "X", "message": "top level"}, "results": []},
    {"results": [{"error": {"code": "X", "message": "result level"}}]},
    {"results": [{"tables": [{"rows": [{"[n]": 1}], "error": {"code": "TooManyRows", "message": "truncated"}}]}]},
    {"results": []},
    {"results": [{"tables": []}]},
])
def test_200_with_error_object_or_no_table_is_502(qdir, body):
    app, _ = make_app(Upstream((200, body)), queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/data_as_of", params=RTS)
    assert r.status_code == 502
    assert "HTTP 200" in r.json()["error"]


def test_400_is_502_with_dax_message(qdir):
    err = {"error": {"code": "DatasetExecuteQueriesError", "pbi.error": {"code": "DatasetExecuteQueriesError",
           "details": [{"code": "DetailsMessage", "detail": {"type": 1,
                        "value": "Query (3, 5) Cannot find table 'dim_person'."}}]}}}
    app, _ = make_app(Upstream((400, err)), queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/persons", params=RTS)
    assert r.status_code == 502
    assert "Cannot find table 'dim_person'" in r.json()["error"]
    assert r.json()["upstream_status"] == 400


def test_error_message_scrubbed_of_data_literals(qdir):
    err = {"error": {"pbi.error": {"details": [{"detail": {
        "value": "Cannot convert value 'Muster, Anna' of type Text to type Number. Table 'dim_person'."}}]}}}
    app, _ = make_app(Upstream((400, err)), queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/persons", params=RTS)
    assert r.status_code == 502 and "Muster" not in r.text and "<redacted>" in r.text
    assert scrub_message("bad 'x' near \"MISSING\"", 'EVALUATE "MISSING"') == "bad '<redacted>' near \"MISSING\""


def test_non_json_error_body_is_502():
    with pytest.raises(DaxError, match="HTTP 503"):
        parse_response(503, "<html>gateway</html>")


def test_include_nulls_always_sent_and_rows_normalised(qdir):
    up = Upstream((200, ok_body([{"[n]": None}])))
    app, _ = make_app(up, queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/data_as_of", params=RTS)
    assert r.status_code == 200
    sent = json.loads(up.requests[0].content)
    assert sent["serializerSettings"] == {"includeNulls": True}
    assert len(sent["queries"]) == 1
    assert r.json()["columns"] == ["n"] and r.json()["rows"] == [{"n": None}]


def test_row_warning_above_threshold(qdir):
    rows = [{"[n]": i} for i in range(ROW_WARN + 1)]
    app, _ = make_app(Upstream((200, ok_body(rows))), queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/data_as_of", params=RTS)
    assert r.status_code == 200 and r.json()["warnings"]


def test_normalise_keys():
    m = normalise_keys(["fact_stage_run[stage]", "[Exec min]", "'dim env'[Env Key]", "[Queue share %]"])
    assert m == {"fact_stage_run[stage]": "stage", "[Exec min]": "exec_min",
                 "'dim env'[Env Key]": "env_key", "[Queue share %]": "queue_share"}


def test_normalise_keys_qualifies_on_clash():
    m = normalise_keys(["fact_run_step[stage]", "dim_run_regime[stage]", "[x]"])
    assert m == {"fact_run_step[stage]": "fact_run_step_stage",
                 "dim_run_regime[stage]": "dim_run_regime_stage", "[x]": "x"}


# ----------------------------------------------------------------------- dataset routing

@pytest.mark.parametrize("path, params, key", [
    ("/api/ac1/q/data_as_of", {"env": "PROD"}, ("import", "RTS", "PROD")),
    ("/api/ac1/q/data_as_of", {"env": "QA"}, ("import", "RTS", "QA")),
    ("/api/ac2/q/persons", {"tenant": "CARGOCONTROL", "env": "PROD"}, ("import", "CARGOCONTROL", "PROD")),
    ("/api/ac2/q/persons", {"tenant": "CARGOCONTROL", "env": "QA"}, ("import", "CARGOCONTROL", "QA")),
    ("/api/ac2/q/persons", {"tenant": "RTS", "env": "PROD"}, ("import", "RTS", "PROD")),
    ("/api/ac8/q/rts_only", {"env": "PROD"}, ("leitstelle_olten", "CARGOCONTROL", "PROD")),
    ("/api/ac8/q/rts_only", {"env": "QA"}, ("leitstelle_olten", "CARGOCONTROL", "QA")),
])
def test_each_selection_hits_its_own_dataset(qdir, path, params, key):
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up, queries_dir=qdir)
    with TestClient(app) as c:
        assert c.get(path, params=params).status_code == 200
    assert str(up.requests[0].url) == D.REGISTRY[key].url


def test_registry_ids_and_lookup():
    # at least the D0 + AC-4 + AC-10 eleven; every model added later keeps this green (core request ac4 #2 / ac7 #1)
    assert len(D.REGISTRY) >= 11 and all(k[0] in D.MODELS for k in D.REGISTRY)
    assert D.lookup("platform_metrics", "RTS", "QA").dataset_id == "e668ce4f-e06d-478b-92b8-3b79b4767d17"
    assert D.tenants_for("leitstelle_olten") == ("CARGOCONTROL",)
    with pytest.raises(D.UnknownDataset):
        D.lookup("leitstelle_olten", "RTS", "PROD")
    # sm_fico (AC-4): CargoControl only, PROD / QA in their own workspaces
    assert D.tenants_for("fico") == ("CARGOCONTROL",)
    prod, qa = D.lookup("fico", "CARGOCONTROL", "PROD"), D.lookup("fico", "CARGOCONTROL", "QA")
    assert (prod.workspace_id, prod.dataset_id) == (D.WS_CC_PROD, "488fad6b-6417-4f7f-9d7b-b41ce1a49ff2")
    assert (qa.workspace_id, qa.dataset_id) == (D.WS_CC_QA, "fcbc592a-a112-4501-8786-c65471432b8c")
    with pytest.raises(D.UnknownDataset):
        D.lookup("fico", "RTS", "PROD")
    # sm_offene_schichten (AC-10): CargoControl only, PROD / QA in their own workspaces
    assert D.tenants_for("offene_schichten") == ("CARGOCONTROL",)
    prod, qa = D.lookup("offene_schichten", "CARGOCONTROL", "PROD"), D.lookup("offene_schichten", "CARGOCONTROL", "QA")
    assert (prod.workspace_id, prod.dataset_id) == (D.WS_CC_PROD, "5d5b844f-d9e1-4bcf-86bb-e4d287a4c219")
    assert (qa.workspace_id, qa.dataset_id) == (D.WS_CC_QA, "ed8fabbc-bfc6-40b5-8c54-9fa1223dde10")
    with pytest.raises(D.UnknownDataset):
        D.lookup("offene_schichten", "RTS", "QA")
    for d in D.REGISTRY.values():
        assert d.confirmed.startswith("inventory")


@pytest.mark.parametrize("path, params", [
    ("/api/ac1/q/data_as_of", {}),
    ("/api/ac1/q/data_as_of", {"env": "prod"}),
    ("/api/ac1/q/data_as_of", {"env": "DEV"}),
    ("/api/ac1/q/data_as_of", {"env": 'PROD") EVALUATE ROW("x", 1) //'}),
    ("/api/ac1/q/data_as_of", {"env": "PROD", "tenant": "CARGOCONTROL"}),     # fixed RTS
    ("/api/ac2/q/persons", {"env": "PROD"}),
    ("/api/ac2/q/persons", {"env": "PROD", "tenant": "LOCLOCATION"}),
    ("/api/ac8/q/rts_only", {"env": "PROD", "tenant": "RTS"}),
    ("/api/ac1/q/data_as_of", {"env": "PROD", "query": 'EVALUATE ROW("x", 1)'}),
    ("/api/ac1/q/data_as_of", {"env": "PROD", "fresh": "yes"}),
])
def test_selectors_reject(qdir, path, params):
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up, queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get(path, params=params)
    assert r.status_code == 400, r.text
    assert up.requests == []


def test_duplicate_param_and_unknown_query(qdir):
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up, queries_dir=qdir)
    with TestClient(app) as c:
        assert c.get("/api/ac1/q/data_as_of?env=PROD&env=QA").status_code == 400
        assert c.get("/api/ac1/q/nope", params=RTS).status_code == 404
        assert c.get("/api/ac1/q/../ac2/persons", params=RTS).status_code == 404
        assert c.get("/api/ac2/q/data_as_of", params=RTS).status_code == 404          # not an ac2 query
    assert up.requests == []


# ----------------------------------------------------------------------- cache

def test_cache_hit_and_fresh_bypass_per_dataset(qdir):
    up = Upstream((200, ok_body([{"[n]": 1}])))
    cache_clock = Clock()
    app, _ = make_app(up, cache_clock=cache_clock, queries_dir=qdir)
    with TestClient(app) as c:
        assert c.get("/api/ac1/q/data_as_of", params=RTS).json()["cached"] is False
        assert c.get("/api/ac1/q/data_as_of", params=RTS).json()["cached"] is True
        assert len(up.requests) == 1
        assert c.get("/api/ac1/q/data_as_of", params={**RTS, "fresh": "1"}).json()["cached"] is False
        assert c.get("/api/ac1/q/data_as_of", params={"env": "QA"}).json()["cached"] is False
        assert len(up.requests) == 3
        cache_clock.t += 601
        assert c.get("/api/ac1/q/data_as_of", params=RTS).json()["cached"] is False
        assert len(up.requests) == 4


def test_errors_are_not_cached(qdir):
    up = Upstream((400, {"error": {"message": "boom"}}), (200, ok_body([{"[n]": 1}])))
    app, _ = make_app(up, queries_dir=qdir)
    with TestClient(app) as c:
        assert c.get("/api/ac1/q/data_as_of", params=RTS).status_code == 502
        assert c.get("/api/ac1/q/data_as_of", params=RTS).status_code == 200
    assert len(up.requests) == 2


def test_default_window_is_canonical_cache_key(qdir):
    up = Upstream((200, ok_body([{"[n]": 1}])))
    app, _ = make_app(up, queries_dir=qdir)
    with TestClient(app) as c:
        a = c.get("/api/ac1/q/window", params=RTS).json()
        b = c.get("/api/ac1/q/window", params={**RTS, "date_from": "2026-09-20", "date_to": "2026-10-20"}).json()
    assert a["params"] == {"date_from": "2026-09-20", "date_to": "2026-10-20"}
    assert b["cached"] is True and len(up.requests) == 1


# ----------------------------------------------------------------------- token

def test_token_refreshed_before_expiry():
    clock = Clock()
    fetched = []

    def fetch():
        fetched.append(clock())
        return Token(f"t{len(fetched)}", clock() + 3600)

    tc = TokenCache(fetcher=fetch, clock=clock)
    assert asyncio.run(tc.get()) == "t1"
    clock.t += 3600 - 301
    assert asyncio.run(tc.get()) == "t1" and tc.get_sync() == "t1"
    clock.t += 2
    assert asyncio.run(tc.get()) == "t2"
    assert len(fetched) == 2


def test_401_refetches_token_once_and_retries():
    up = Upstream((401, ""), (200, ok_body([{"[n]": 1}])))
    client = make_client(up)
    res = asyncio.run(client.execute(D.REGISTRY[("import", "RTS", "PROD")], 'EVALUATE ROW("n", 1)'))
    assert res.rows == [{"n": 1}]
    assert [r.headers["Authorization"] for r in up.requests] == ["Bearer tok1", "Bearer tok2"]


def test_second_401_is_an_error():
    up = Upstream((401, ""), (401, ""))
    with pytest.raises(DaxError, match="HTTP 401"):
        asyncio.run(make_client(up).execute(D.REGISTRY[("import", "RTS", "PROD")], 'EVALUATE ROW("n", 1)'))
    assert len(up.requests) == 2


# ----------------------------------------------------------------------- limiter

def test_limiter_default_is_35_and_sliding(monkeypatch):
    monkeypatch.delenv("DEMO_LIMIT_PER_MIN", raising=False)
    assert DEFAULT_PER_MINUTE == 35 and MAX_PER_MINUTE == 110
    clock = Clock()
    lim = RateLimiter(clock=clock)
    assert lim.per_minute == 35
    for _ in range(35):
        lim.acquire()
    with pytest.raises(RateLimited):
        lim.acquire()
    clock.t += 59.9
    with pytest.raises(RateLimited):
        lim.acquire()
    clock.t += 0.2
    lim.acquire()
    assert lim.calls_last_minute() == 1 and lim.peak_per_minute == 35 and lim.total == 36


@pytest.mark.parametrize("raw, expected", [("55", 55), ("110", 110), ("", 35), ("1", 1)])
def test_limiter_from_env(monkeypatch, raw, expected):
    monkeypatch.setenv("DEMO_LIMIT_PER_MIN", raw)
    assert per_minute_from_env() == expected and RateLimiter().per_minute == expected


@pytest.mark.parametrize("raw", ["111", "0", "-5", "lots", "35.5"])
def test_limiter_env_out_of_range_refused(monkeypatch, raw):
    monkeypatch.setenv("DEMO_LIMIT_PER_MIN", raw)
    with pytest.raises(ValueError):
        RateLimiter()


def test_limiter_maps_to_429_without_upstream_call(qdir):
    lim = RateLimiter(per_minute=2, clock=Clock())
    up = Upstream((200, ok_body([{"[n]": 1}])))
    app, _ = make_app(up, limiter=lim, queries_dir=qdir)
    with TestClient(app) as c:
        p = {**RTS, "fresh": "1"}
        assert c.get("/api/ac1/q/data_as_of", params=p).status_code == 200
        assert c.get("/api/ac1/q/data_as_of", params=p).status_code == 200
        r = c.get("/api/ac1/q/data_as_of", params=p)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1
    assert len(up.requests) == 2
