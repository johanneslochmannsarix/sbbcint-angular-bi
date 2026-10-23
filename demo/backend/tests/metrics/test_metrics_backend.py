"""/metrics offline tests (option B): the metrics-specific tests of the original metrics backend
(tmp/metrics_app_spike/backend/tests/test_backend.py) ported onto the demo core. Guard, cache, limiter,
token and CORS tests are not repeated here: tests/core covers them for every showcase. No Fabric, no az."""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.core import queries as Q
from app.core.masking import Masker
from tests.support import TODAY, Upstream, make_app, ok_body

METRICS = Q.load_queries()["metrics"]
UUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"
NONE = Q.Selection(None, None)
ORIGINAL = Q.QUERIES_DIR.parent.parent.parent / "backend" / "queries"      # tmp/metrics_app_spike/backend


def _required(q: Q.NamedQuery) -> dict[str, str]:
    raw = {}
    for p in q.params.values():
        if p.required:
            raw[p.name] = {"env": "PROD", "tenant": "RTS", "chain_id": UUID}[p.name]
    return raw


def _body(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("--")).strip()


# ----------------------------------------------------------------------- definitions

def test_all_23_queries_on_platform_metrics_without_person_data():
    assert len(METRICS) == 25
    for q in METRICS.values():
        assert q.model == "platform_metrics" and q.tenant is None and not q.person_keys, q.qid
        assert set(q.roles.values()) <= {"id", "code", "date", "measure", "label_technical"}, q.qid
        assert q.meta.get("replaces") and q.meta.get("view") and q.meta.get("grain"), q.qid


@pytest.mark.skipif(not ORIGINAL.exists(), reason="original metrics backend deleted")
def test_dax_unchanged_against_the_original_backend():
    for q in METRICS.values():
        old = (ORIGINAL / f"{q.qid}.dax").read_text(encoding="utf-8")
        new = (Q.QUERIES_DIR / "metrics" / f"{q.qid}.dax").read_text(encoding="utf-8")
        assert _body(old) == _body(new), q.qid


# P1 param rules, per query: env / tenant required|optional, default window
RULES = {
    **{n: ("required", "optional", 30) for n in ("anatomy_kpis", "anatomy_stage_queue", "anatomy_executor_busy",
                                                 "anatomy_exec_trend", "anatomy_stage_table", "anatomy_chains")},
    **{n: ("required", "required", 30) for n in ("pareto_kpis", "pareto_ingest_top20", "pareto_ingest_scatter",
                                                 "pareto_silver", "pareto_gold")},
    **{n: ("required", "required", 90) for n in ("stability_box", "stability_control", "stability_table",
                                                 "stability_cv_by_step", "stability_regimes", "trend_batch_table")},
    **{n: ("optional", "optional", 90) for n in ("trend_size_by_env", "trend_size_by_tenant", "trend_batch_size")},
}


@pytest.mark.parametrize("name", sorted(RULES))
def test_param_rules(name):
    q = METRICS[name]
    env, tenant, days = RULES[name]
    assert set(q.params) == {"env", "tenant", "dates"}
    assert q.params["env"].required == (env == "required")
    assert q.params["tenant"].required == (tenant == "required")
    assert q.params["env"].filter_column == "'dim_env'[env]"
    assert q.params["tenant"].filter_column == "'dim_env'[tenant]"
    assert q.params["dates"].default_days == days and q.params["dates"].anchor == "to_today"


def test_chain_and_header_queries():
    for n in ("anatomy_gantt", "anatomy_spark_stages"):
        assert set(METRICS[n].params) == {"chain_id"}
        assert METRICS[n].params["chain_id"].type == "uuid" and METRICS[n].params["chain_id"].required
    assert METRICS["data_as_of"].params == {}


# ----------------------------------------------------------------------- whitelist

@pytest.mark.parametrize("params", [
    {"env": 'PROD") EVALUATE ROW("x", 1) //'},
    {"env": "prod"},
    {"env": "PROD "},
    {"env": "PROD", "tenant": "LOCLOCATION"},
    {"env": "PROD", "tenant": 'RTS"}, \'dim_env\'[tenant]) EVALUATE ROW("x",1)//'},
    {"env": "PROD", "date_from": "2026-1-1"},
    {"env": "PROD", "date_from": "20261001"},
    {"env": "PROD", "date_from": "2026-02-30"},
    {"env": "PROD", "date_to": "2026-10-20T00:00:00"},
    {"env": "PROD", "date_from": "2026-10-21", "date_to": "2026-10-20"},
    {"env": "PROD", "date_from": "2024-01-01", "date_to": "2026-10-20"},
    {"env": "PROD", "query": "EVALUATE ROW(\"x\", 1)"},
    {"env": "PROD", "fresh": "yes"},
    {"tenant": "RTS"},
])
def test_whitelist_rejects(params):
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up)
    with TestClient(app) as c:
        r = c.get("/api/metrics/q/anatomy_kpis", params=params)
    assert r.status_code == 400, r.text
    assert up.requests == []


@pytest.mark.parametrize("chain_id", [
    "not-a-uuid", UUID.upper(), UUID[:-1] + '"', UUID + "0", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
    '") EVALUATE ROW("x",1) //-----------',
])
def test_chain_id_rejects(chain_id):
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up)
    with TestClient(app) as c:
        r = c.get("/api/metrics/q/anatomy_gantt", params={"chain_id": chain_id})
    assert r.status_code == 400
    assert up.requests == []


def test_param_not_declared_by_query_is_rejected():
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up)
    with TestClient(app) as c:
        assert c.get("/api/metrics/q/anatomy_gantt", params={"chain_id": UUID, "env": "PROD"}).status_code == 400
        assert c.get("/api/metrics/q/data_as_of", params={"tenant": "RTS"}).status_code == 400
        assert c.get("/api/metrics/q/anatomy_kpis?env=PROD&env=QA").status_code == 400
        assert c.get("/api/metrics/q/pareto_kpis", params={"env": "PROD"}).status_code == 400   # needs ONE tenant
        assert c.get("/api/metrics/q/nope").status_code == 404
    assert up.requests == []


# ----------------------------------------------------------------------- render

def test_render_uses_only_whitelist_literals():
    q, m = METRICS["anatomy_kpis"], Masker(real=False)
    p = Q.validate(q, {"env": "QA", "date_from": "2026-10-01", "date_to": "2026-10-20"}, NONE, m, today=TODAY)
    dax = Q.render(q, p, NONE, m)
    assert 'TREATAS ( { "QA" }, \'dim_env\'[env] )' in dax
    assert "ALL ( 'dim_env'[tenant] )" in dax              # optional + absent = no filter (empty slicer)
    p2 = Q.validate(q, {"env": "QA", "tenant": "RTS"}, NONE, m, today=TODAY)
    assert "TREATAS ( { \"RTS\" }, 'dim_env'[tenant] )" in Q.render(q, p2, NONE, m)
    assert "DATE ( 2026, 10, 1 )" in dax and "DATE ( 2026, 10, 20 )" in dax
    g = METRICS["anatomy_gantt"]
    assert f'{{ "{UUID}" }}' in Q.render(g, Q.validate(g, {"chain_id": UUID}, NONE, m, today=TODAY), NONE, m)


def test_default_window():
    q = METRICS["stability_box"]
    p = Q.validate(q, {"env": "PROD", "tenant": "RTS"}, NONE, Masker(real=False), today=TODAY)
    assert p["date_to"] == TODAY and p["date_from"] == TODAY - dt.timedelta(days=90)


def test_all_query_files_render():
    m = Masker(real=False)
    for q in METRICS.values():
        dax = Q.render(q, Q.validate(q, _required(q), NONE, m, today=TODAY), NONE, m)
        assert dax.lstrip().startswith("EVALUATE")
        assert "{{" not in dax and "}}" not in dax.replace("} }", "")


def test_queries_endpoint_lists_params():
    app, _ = make_app(Upstream((200, ok_body([]))))
    with TestClient(app) as c:
        body = c.get("/api/metrics/queries").json()
        assert c.get("/api/metrics/ping").json() == {"showcase": "metrics", "ok": True}
    names = {q["name"]: q for q in body["queries"]}
    assert {p["name"] for p in names["anatomy_gantt"]["params"]} == {"chain_id"}
    assert {p["name"] for p in names["pareto_kpis"]["params"]} == {"env", "tenant", "date_from", "date_to"}


def test_end_to_end_rows_pass_through_unmasked():
    """No person data on this model: technical labels and codes come back as the upstream sent them."""
    rows = [{"fact_run_step[key]": "public_table_x", "[gold_s_per_run]": 12.5}]
    up = Upstream((200, ok_body(rows)))
    app, _ = make_app(up)
    with TestClient(app) as c:
        r = c.get("/api/metrics/q/pareto_gold", params={"env": "PROD", "tenant": "CARGOCONTROL",
                                                        "date_from": "2026-10-01", "date_to": "2026-10-20"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rows"] == [{"key": "public_table_x", "gold_s_per_run": 12.5}]
    assert body["roles"] == {"key": "label_technical", "gold_s_per_run": "measure"}
    sent = up.requests[0].read().decode()
    assert "CARGOCONTROL" in sent and "'dim_env'[tenant]" in sent
