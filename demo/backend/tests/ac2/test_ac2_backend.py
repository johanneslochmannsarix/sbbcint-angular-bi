"""AC-2 offline tests, rehomed from tmp/metrics_app_spike/ac2/backend/tests/test_backend.py (67 tests) in D0.

Same assertions against the demo core: /api/q/<name> became /api/ac2/q/<name>, the AC2_REAL switch became
DEMO_REAL, the dataset map moved to core/datasets.py, query headers moved to <name>.roles.json, the per-
instance limiter is configurable (AC-2's 110/min is passed explicitly), and CORS now allows 4200-4203.
All person strings below are invented fixtures.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import hmac
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import datasets as D
from app.core import queries as Q
from app.core.cache import ResponseCache
from app.core.dax_client import ROW_WARN, DaxError, Token, TokenCache, normalise_keys, parse_response, scrub_message
from app.core.limiter import RateLimited, RateLimiter
from app.core.masking import PERSON_COLUMNS, PSEUDONYM_RE, ROLES, Masker
from app.main import create_app
from tests.support import Clock, Upstream, fake_bronze, make_client, ok_body, write_query

TODAY = dt.date(2026, 10, 20)
SK = "a" * 64
SK2 = "b" * 64
QSK = "c" * 64
AC2 = "/api/ac2/q"

FAKE_PEOPLE = [
    {"sk": "1f" * 32, "name": "Muster, Anna", "nr": "4711"},
    {"sk": "2e" * 32, "name": "Beispiel, Bruno", "nr": "0815"},
    {"sk": "3d" * 32, "name": "Zürcher-Ölmann, Chloé", "nr": "123456"},
]
AC2_DATASETS = sorted((t, e) for (m, t, e) in D.REGISTRY if m == "import")


def make_app(upstream: Upstream, cache_clock: Clock | None = None, limiter: RateLimiter | None = None,
             masker: Masker | None = None, registry=None):
    client = make_client(upstream, limiter=limiter or RateLimiter(per_minute=110, clock=Clock()))
    app = create_app(client=client, cache=ResponseCache(clock=cache_clock or Clock()),
                     masker=Masker(real=False) if masker is None else masker, registry=registry, bronze=fake_bronze(),
                     today=lambda: TODAY)
    return app, client


CC = {"tenant": "CARGOCONTROL", "env": "PROD"}
RTS = {"tenant": "RTS", "env": "QA"}


def persons_payload(people=FAKE_PEOPLE, blank_last=False) -> dict:
    rows = []
    for i, p in enumerate(people):
        name = "" if (blank_last and i == len(people) - 1) else p["name"]
        rows.append({"dim_person[person_sk]": p["sk"], "dim_person[person_name]": name,
                     "dim_tenant[tenant_sk]": QSK, "dim_tenant[tenant_name]": "SBB Cargo Org X", "[pairs]": 39})
    return ok_body(rows)


# ======================================================================= masking (IRON RULE)

def test_masked_response_contains_no_person_string():
    app, _ = make_app(Upstream((200, persons_payload())))
    with TestClient(app) as c:
        r = c.get(f"{AC2}/persons", params=CC)
    assert r.status_code == 200
    text = r.text
    for p in FAKE_PEOPLE:
        for s in (p["sk"], p["name"], p["name"].split(",")[0], p["name"].split(", ")[1]):
            assert s not in text, "a person string survived masking"
    body = r.json()
    assert body["mode"] == "masked"
    assert body["roles"]["person_sk"] == "label_person" and body["roles"]["tenant_name"] == "label_org"
    for row in body["rows"]:
        assert PSEUDONYM_RE.match(row["person_sk"])
        assert row["person_name"] == row["person_sk"]          # label replaced by the row's pseudonym
        assert row["tenant_name"] == "SBB Cargo Org X"         # org units stay readable


def test_masked_expiries_with_names_in_every_label_person_column():
    rows = [{"[person_sk]": p["sk"], "[person_name]": p["name"], "[tenant_name]": "Org",
             "[qualification_name]": "Q", "[status_code]": "VALID_LT_90", "[valid_to]": "2026-11-01T00:00:00"}
            for p in FAKE_PEOPLE]
    app, _ = make_app(Upstream((200, ok_body(rows))))
    with TestClient(app) as c:
        r = c.get(f"{AC2}/expiries", params=CC)
    assert r.status_code == 200
    for p in FAKE_PEOPLE:
        assert p["name"] not in r.text and p["sk"] not in r.text


def test_blank_name_stays_null_not_pseudonym():
    """QDASH-8: people without names must stay visible as 'no name', not get a fake label."""
    app, _ = make_app(Upstream((200, persons_payload(blank_last=True))))
    with TestClient(app) as c:
        rows = c.get(f"{AC2}/persons", params=CC).json()["rows"]
    assert rows[-1]["person_name"] is None and PSEUDONYM_RE.match(rows[-1]["person_sk"])
    assert rows[0]["person_name"] is not None


def test_pseudonyms_stable_within_process_and_differ_across_keys():
    m1, m2 = Masker(real=False), Masker(real=False)
    a = m1.pseudonym(SK, "CARGOCONTROL")
    assert a == m1.pseudonym(SK, "CARGOCONTROL") and a != m1.pseudonym(SK2, "CARGOCONTROL")
    assert a != m2.pseudonym(SK, "CARGOCONTROL")            # random per-process key
    assert m1.resolve(a).key == SK and m1.resolve("P-000000") is None


def test_pseudonym_collision_gets_longer():
    m = Masker(real=False)
    digest = hmac.new(m._key, "\x1f".join(["person", "CARGOCONTROL", SK]).encode(), hashlib.sha256).hexdigest()
    m._by_pseudonym["P-" + digest[:6]] = "other"
    p = m.pseudonym(SK, "CARGOCONTROL")
    assert len(p) == 2 + 8 and m.resolve(p).key == SK


def test_real_mode_only_with_env(monkeypatch):
    monkeypatch.delenv("DEMO_REAL", raising=False)
    assert Masker().real is False
    monkeypatch.setenv("DEMO_REAL", "0")
    assert Masker().real is False
    monkeypatch.setenv("DEMO_REAL", "1")
    m = Masker()
    assert m.real is True
    rows = m.mask_rows([{"person_sk": SK, "person_name": "Muster, Anna"}],
                       {"person_sk": "label_person", "person_name": "label_person"}, "CARGOCONTROL",
                       ("person_sk",), {"person_name": "person_sk"})
    assert rows[0]["person_name"] == "Muster, Anna" and rows[0]["person_sk"] != SK   # key still pseudonymised


def test_masked_payload_is_what_gets_cached():
    up = Upstream((200, persons_payload()))
    cache = ResponseCache(clock=Clock())
    app = create_app(client=make_client(up), cache=cache, masker=Masker(real=False), bronze=fake_bronze(),
                     today=lambda: TODAY)
    with TestClient(app) as c:
        c.get(f"{AC2}/persons", params=CC)
    stored = json.dumps([v for _, v in cache._data.values()])
    for p in FAKE_PEOPLE:
        assert p["name"] not in stored and p["sk"] not in stored


def test_error_message_is_scrubbed_of_data_literals():
    err = {"error": {"pbi.error": {"details": [{"detail": {
        "value": "Cannot convert value 'Muster, Anna' of type Text to type Number. Table 'dim_person'."}}]}}}
    app, _ = make_app(Upstream((400, err)))
    with TestClient(app) as c:
        r = c.get(f"{AC2}/persons", params=CC)
    assert r.status_code == 502
    assert "Muster" not in r.text and "<redacted>" in r.text
    assert "'dim_person'" in r.text          # identifiers that occur in our own DAX survive


def test_scrub_keeps_literals_from_the_query():
    assert scrub_message("bad 'x' near \"MISSING_NEVER\"", 'EVALUATE "MISSING_NEVER"') == \
        "bad '<redacted>' near \"MISSING_NEVER\""


# ======================================================================= role coverage

def test_undeclared_column_is_502_never_passthrough():
    rows = [{"dim_person[person_sk]": FAKE_PEOPLE[0]["sk"], "dim_person[person_name]": "Muster, Anna",
             "dim_tenant[tenant_sk]": QSK, "dim_tenant[tenant_name]": "Org", "[pairs]": 1,
             "dim_person[personnelnumber]": "4711"}]
    app, _ = make_app(Upstream((200, ok_body(rows))))
    with TestClient(app) as c:
        r = c.get(f"{AC2}/persons", params=CC)
    assert r.status_code == 502
    assert "undeclared column" in r.json()["error"]
    assert "4711" not in r.text and "Muster" not in r.text


def test_missing_declared_column_is_502():
    rows = [{"dim_person[person_sk]": SK, "dim_person[person_name]": "x", "[pairs]": 1}]
    app, _ = make_app(Upstream((200, ok_body(rows))))
    with TestClient(app) as c:
        r = c.get(f"{AC2}/persons", params=CC)
    assert r.status_code == 502 and "missing from the result" in r.json()["error"]


def test_zero_rows_is_200_and_empty():
    app, _ = make_app(Upstream((200, ok_body([]))))
    with TestClient(app) as c:
        r = c.get(f"{AC2}/persons", params=CC)
    assert r.status_code == 200 and r.json()["rows"] == [] and r.json()["columns"]


HDR = {"model": "import", "tenant": "CARGOCONTROL", "replaces": "x", "view": "x", "grain": "x"}


def _write(tmp: Path, dax: str, roles: dict) -> Path:
    return write_query(tmp / "q", "ac2", "cc/bad", dax, roles)


@pytest.mark.parametrize("dax, roles, msg", [
    ('EVALUATE ROW("person_name", 1)\n', {**HDR, "columns": {"person_name": "label_org"}}, "person data"),
    ('EVALUATE ROW("person_sk", 1)\n', {**HDR, "columns": {"person_sk": "label_person"}}, "person_key"),
    ('EVALUATE ROW("n", 1)\n', {**HDR, "columns": {"n": "measure", "m": "measure"}}, "not produced"),
    ('EVALUATE ROW("n", 1)\n', {**HDR, "columns": {"n": "fancy"}}, "unknown role"),
    ('EVALUATE ROW("n", MAX(\'dim_person\'[personnelnumber]))\n', {**HDR, "columns": {"n": "measure"}},
     "AC-2 minimisation"),
    ('EVALUATE ROW("n", MAX(\'dim_person\'[firstname]))\n', {**HDR, "columns": {"n": "measure"}}, "AC-2 minimisation"),
    ('EVALUATE ROW("n", MAX(\'dim_person\'[date_of_birth]))\n', {**HDR, "columns": {"n": "date"}}, "date of birth"),
    ('EVALUATE ROW("n", COUNTROWS(\'dim_person\'))\n', {**HDR, "columns": {"n": "measure"}}, "person key"),
    ('EVALUATE ROW("n", 1)\n', {k: v for k, v in HDR.items() if k not in ("view", "grain")} | {"columns": {"n": "measure"}},
     "needs 'view'"),
    ('EVALUATE ROW("n", 1)\n', {**HDR, "columnz": {"n": "measure"}, "columns": {"n": "measure"}}, "unknown key"),
])
def test_startup_self_check_refuses_bad_definitions(tmp_path, dax, roles, msg):
    from app.core import forbidden as F
    d = _write(tmp_path, dax, roles)
    with pytest.raises((Q.QueryDefinitionError, F.ForbiddenColumnError), match=msg):
        F.enforce(d)                      # the minimisation / birth-date checks live in core/forbidden.py
        Q.load_queries(d)


def test_create_app_refuses_to_start_on_a_bad_definition(tmp_path):
    d = _write(tmp_path, 'EVALUATE ROW("person_name", 1)\n', {**HDR, "columns": {"person_name": "code"}})
    with pytest.raises(Q.QueryDefinitionError):
        create_app(client=make_client(Upstream((200, ok_body([])))), bronze=fake_bronze(), queries_dir=d)


def test_real_query_files_pass_the_self_check_and_declare_every_column():
    reg = Q.load_queries()["ac2"]
    by_tenant: dict[str, dict] = {}
    for q in reg.values():
        by_tenant.setdefault(q.tenant, {})[q.name] = q
    assert set(by_tenant) == {"CARGOCONTROL", "RTS"}
    for tenant, qs in by_tenant.items():
        assert {"qualifications", "persons", "pairs", "status_by_qualification", "status_codes",
                "data_as_of", "person_detail", "expiries"} <= set(qs), tenant
        for q in qs.values():
            assert q.columns and all(r in ROLES for r in q.columns.values())
            for col, role in q.columns.items():
                if col in PERSON_COLUMNS:
                    assert role == "label_person", f"{tenant}/{q.name}/{col}"
    assert "org" not in by_tenant["RTS"]["expiries"].accepted_keys          # RT&S has no org level


# ======================================================================= dataset routing + whitelist

@pytest.mark.parametrize("tenant, env", AC2_DATASETS)
def test_each_tenant_env_hits_its_own_dataset(tenant, env):
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up)
    with TestClient(app) as c:
        assert c.get(f"{AC2}/qualifications", params={"tenant": tenant, "env": env}).status_code == 200
    d = D.REGISTRY[("import", tenant, env)]
    assert str(up.requests[0].url) == \
        f"https://api.powerbi.com/v1.0/myorg/groups/{d.workspace_id}/datasets/{d.dataset_id}/executeQueries"


@pytest.mark.parametrize("params", [
    {},
    {"tenant": "CARGOCONTROL"},
    {"env": "PROD"},
    {"tenant": "LOCLOCATION", "env": "PROD"},
    {"tenant": "cargocontrol", "env": "PROD"},
    {"tenant": "RTS", "env": "DEV"},
    {"tenant": "RTS", "env": 'PROD") EVALUATE ROW("x", 1) //'},
    {**CC, "query": 'EVALUATE ROW("x", 1)'},
    {**CC, "fresh": "yes"},
    {**CC, "person": "P-123"},          # persons takes no person param
])
def test_whitelist_rejects(params):
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up)
    with TestClient(app) as c:
        r = c.get(f"{AC2}/persons", params=params)
    assert r.status_code == 400, r.text
    assert up.requests == []


@pytest.mark.parametrize("params", [
    {**CC, "qualification": 'x" } , ALL(dim_person) ) EVALUATE ROW("x",1) //'},
    {**CC, "qualification": "short"},
    {**CC, "org": "a'b" + "c" * 20},
    {**CC, "date_from": "2026-1-1"},
    {**CC, "date_from": "2026-02-30"},
    {**CC, "date_from": "2026-10-21", "date_to": "2026-10-20"},
    {**CC, "date_from": "2026-01-01", "date_to": "2027-12-31"},
    {**RTS, "org": QSK},               # RT&S expiries has no org filter
])
def test_typed_filters_reject(params):
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up)
    with TestClient(app) as c:
        r = c.get(f"{AC2}/expiries", params=params)
    assert r.status_code == 400, r.text
    assert up.requests == []


def test_unknown_query_per_tenant_is_404():
    app, _ = make_app(Upstream((200, ok_body([]))))
    with TestClient(app) as c:
        assert c.get(f"{AC2}/nope", params=CC).status_code == 404


def test_pseudonym_filter_resolves_server_side_and_never_sends_a_name():
    m = Masker(real=False)
    up = Upstream((200, persons_payload()), (200, ok_body([])))
    app, _ = make_app(up, masker=m)
    with TestClient(app) as c:
        rows = c.get(f"{AC2}/persons", params=CC).json()["rows"]
        pseudo = rows[1]["person_sk"]
        r = c.get(f"{AC2}/person_detail", params={**CC, "person": pseudo})
        assert r.status_code == 200
        assert r.json()["params"] == {"person": pseudo}               # the echo holds the pseudonym only
        dax = up.sent_query()
        assert f'TREATAS ( {{ "{FAKE_PEOPLE[1]["sk"]}" }}, \'dim_person\'[person_sk] )' in dax
        assert FAKE_PEOPLE[1]["name"] not in dax
        assert c.get(f"{AC2}/person_detail", params={**CC, "person": "P-abcdef"}).status_code == 400
        assert c.get(f"{AC2}/person_detail", params={**CC, "person": "Muster"}).status_code == 400


def test_render_optional_filters_and_dates():
    reg = Q.load_queries()["ac2"]
    q = reg["cc/expiries"]
    m = Masker(real=False)
    sel = Q.Selection("CARGOCONTROL", "PROD")
    p = Q.validate(q, {}, sel, m, today=TODAY)
    assert p["date_from"] == TODAY and p["date_to"] == TODAY + dt.timedelta(days=365)
    dax = Q.render(q, p, sel, m)
    assert "ALL ( 'dim_qualification'[qualification_sk] )" in dax and "ALL ( 'dim_tenant'[tenant_sk] )" in dax
    assert "DATE ( 2026, 10, 20 )" in dax and "DATE ( 2027, 10, 20 )" in dax
    p2 = Q.validate(q, {"qualification": QSK, "date_from": "2026-11-03", "date_to": "2026-11-03"}, sel, m, today=TODAY)
    dax2 = Q.render(q, p2, sel, m)
    assert f'TREATAS ( {{ "{QSK}" }}, \'dim_qualification\'[qualification_sk] )' in dax2
    assert dax2.count("DATE ( 2026, 11, 3 )") == 2


# ======================================================================= response guard (copied)

@pytest.mark.parametrize("body", [
    {"error": {"code": "X", "message": "top level"}, "results": []},
    {"results": [{"error": {"code": "X", "message": "result level"}}]},
    {"results": [{"tables": [{"rows": [{"[n]": 1}], "error": {"code": "TooManyRows", "message": "truncated"}}]}]},
])
def test_200_with_error_object_is_502(body):
    app, _ = make_app(Upstream((200, body)))
    with TestClient(app) as c:
        r = c.get(f"{AC2}/data_as_of", params=CC)
    assert r.status_code == 502
    assert "HTTP 200 with" in r.json()["error"]


def test_400_is_502_with_dax_message():
    err = {"error": {"code": "DatasetExecuteQueriesError", "pbi.error": {"code": "DatasetExecuteQueriesError",
           "details": [{"code": "DetailsMessage", "detail": {"type": 1,
                        "value": "Query (3, 5) Cannot find table 'agg_pipeline_datenstand'."}}]}}}
    app, _ = make_app(Upstream((400, err)))
    with TestClient(app) as c:
        r = c.get(f"{AC2}/data_as_of", params=CC)
    assert r.status_code == 502
    assert "Cannot find table 'agg_pipeline_datenstand'" in r.json()["error"]
    assert r.json()["upstream_status"] == 400


def test_non_json_error_body_is_502():
    with pytest.raises(DaxError, match="HTTP 503"):
        parse_response(503, "<html>gateway</html>")


def test_include_nulls_always_sent_and_rows_normalised():
    up = Upstream((200, ok_body([{"[datenstand_local]": None, "[batch_time]": "1899-12-30T05:31:00"}])))
    app, _ = make_app(up)
    with TestClient(app) as c:
        r = c.get(f"{AC2}/data_as_of", params=CC)
    assert r.status_code == 200
    sent = json.loads(up.requests[0].content)
    assert sent["serializerSettings"] == {"includeNulls": True}
    assert len(sent["queries"]) == 1
    assert r.json()["columns"] == ["datenstand_local", "batch_time"]
    assert r.json()["rows"] == [{"datenstand_local": None, "batch_time": "1899-12-30T05:31:00"}]


def test_row_warning_above_threshold():
    rows = [{"[qualification_sk]": str(i), "[qualification_name]": "q"} for i in range(ROW_WARN + 1)]
    app, _ = make_app(Upstream((200, ok_body(rows))))
    with TestClient(app) as c:
        r = c.get(f"{AC2}/qualifications", params=CC)
    assert r.status_code == 200 and r.json()["warnings"]


def test_normalise_keys():
    m = normalise_keys(["fact_stage_run[stage]", "[Exec min]", "'dim env'[Env Key]", "[Queue share %]"])
    assert m == {"fact_stage_run[stage]": "stage", "[Exec min]": "exec_min",
                 "'dim env'[Env Key]": "env_key", "[Queue share %]": "queue_share"}


def test_normalise_keys_qualifies_on_clash():
    m = normalise_keys(["fact_run_step[stage]", "dim_run_regime[stage]", "[x]"])
    assert m == {"fact_run_step[stage]": "fact_run_step_stage",
                 "dim_run_regime[stage]": "dim_run_regime_stage", "[x]": "x"}


# ======================================================================= cache (copied, adapted)

def test_cache_hit_and_fresh_bypass_per_dataset():
    up = Upstream((200, ok_body([{"[qualification_sk]": "q1", "[qualification_name]": "Q"}])))
    cache_clock = Clock()
    app, _ = make_app(up, cache_clock=cache_clock)
    with TestClient(app) as c:
        assert c.get(f"{AC2}/qualifications", params=CC).json()["cached"] is False
        assert c.get(f"{AC2}/qualifications", params=CC).json()["cached"] is True
        assert len(up.requests) == 1
        assert c.get(f"{AC2}/qualifications", params={**CC, "fresh": "1"}).json()["cached"] is False
        assert len(up.requests) == 2
        assert c.get(f"{AC2}/qualifications", params={**CC, "env": "QA"}).json()["cached"] is False
        assert c.get(f"{AC2}/qualifications", params={"tenant": "RTS", "env": "PROD"}).json()["cached"] is False
        assert len(up.requests) == 4
        cache_clock.t += 601
        assert c.get(f"{AC2}/qualifications", params=CC).json()["cached"] is False
        assert len(up.requests) == 5


def test_errors_are_not_cached():
    up = Upstream((400, {"error": {"message": "boom"}}),
                  (200, ok_body([{"[datenstand_local]": None, "[batch_time]": None}])))
    app, _ = make_app(up)
    with TestClient(app) as c:
        assert c.get(f"{AC2}/data_as_of", params=CC).status_code == 502
        assert c.get(f"{AC2}/data_as_of", params=CC).status_code == 200
    assert len(up.requests) == 2


# ======================================================================= token (copied)

def test_token_refreshed_before_expiry():
    clock = Clock()
    fetched = []

    def fetch():
        fetched.append(clock())
        return Token(f"t{len(fetched)}", clock() + 3600)

    tc = TokenCache(fetcher=fetch, clock=clock)
    assert asyncio.run(tc.get()) == "t1"
    clock.t += 3600 - 301
    assert asyncio.run(tc.get()) == "t1"
    clock.t += 2
    assert asyncio.run(tc.get()) == "t2"


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


# ======================================================================= limiter (copied, 110/min)

def test_limiter_sliding_window_at_110():
    clock = Clock()
    lim = RateLimiter(per_minute=110, clock=clock)
    for _ in range(110):
        lim.acquire()
    with pytest.raises(RateLimited):
        lim.acquire()
    clock.t += 59.9
    with pytest.raises(RateLimited):
        lim.acquire()
    clock.t += 0.2
    lim.acquire()
    assert lim.calls_last_minute() == 1 and lim.peak_per_minute == 110 and lim.total == 111


def test_limiter_maps_to_429_without_upstream_call():
    lim = RateLimiter(per_minute=2, clock=Clock())
    up = Upstream((200, ok_body([{"[qualification_sk]": "q", "[qualification_name]": "Q"}])))
    app, _ = make_app(up, limiter=lim)
    with TestClient(app) as c:
        p = {**CC, "fresh": "1"}
        assert c.get(f"{AC2}/qualifications", params=p).status_code == 200
        assert c.get(f"{AC2}/qualifications", params=p).status_code == 200
        r = c.get(f"{AC2}/qualifications", params=p)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1
    assert len(up.requests) == 2


# ======================================================================= health + CORS

def test_health_reports_mode_and_counters_without_token():
    up = Upstream((200, ok_body([{"[qualification_sk]": "q", "[qualification_name]": "Q"}])))
    app, _ = make_app(up)
    with TestClient(app) as c:
        c.get(f"{AC2}/qualifications", params=CC)
        h = c.get("/api/health").json()
    assert h["mode"] == "masked" and h["calls_total"] == 1 and h["calls_peak_per_minute"] == 1
    assert h["limit_per_minute"] == 110 and "tok1" not in json.dumps(h)


def test_cors_allows_localhost_4201():
    app, _ = make_app(Upstream((200, ok_body([]))))
    with TestClient(app) as c:
        ok = c.get("/api/ac2/queries", headers={"Origin": "http://localhost:4201"})
        other = c.get("/api/ac2/queries", headers={"Origin": "http://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:4201"
    assert "access-control-allow-origin" not in other.headers
