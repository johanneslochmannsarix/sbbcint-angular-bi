"""Startup self-check of query definitions (.dax + .roles.json) and the typed param whitelist."""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.core import queries as Q
from app.core.masking import Masker
from tests.support import TODAY, Upstream, make_app, make_client, meta, ok_body, write_query

ROW = 'EVALUATE ROW ( "n", 1 )\n'


@pytest.mark.parametrize("dax, roles, msg", [
    ('EVALUATE ROW ( "person_name", 1 )\n', meta(columns={"person_name": "label_org"}), "person data"),
    ('EVALUATE ROW ( "beschreibung", 1 )\n', meta(columns={"beschreibung": "code"}), "free text"),
    ('EVALUATE ROW ( "person_sk", 1 )\n', meta(columns={"person_sk": "label_person"}), "person_key"),
    ('EVALUATE ROW ( "a", 1, "b", 2, "c", 3 )\n',
     meta(columns={"a": "label_person", "b": "label_person", "c": "label_person"}, person_key=["a", "b"]),
     "needs a person_key"),
    ('EVALUATE ROW ( "a", 1, "c", 3 )\n',
     meta(columns={"a": "label_person", "c": {"role": "label_person", "person": "zz"}}, person_key="a"),
     "not a person_key"),
    ('EVALUATE ROW ( "a", 1 )\n', meta(columns={"a": "code"}, person_key="a"), "must be a declared label_person"),
    (ROW, meta(columns={"n": "measure", "m": "measure"}), "not produced"),
    (ROW, meta(columns={"n": "fancy"}), "unknown role"),
    (ROW, meta(columns={"n": "measure"}, extra=1), "unknown key"),
    (ROW, {"model": "import", "tenant": "RTS", "replaces": "x", "columns": {"n": "measure"}}, "needs 'view'"),
    (ROW, meta(model="nope", columns={"n": "measure"}), "unknown model"),
    (ROW, meta(model="leitstelle_olten", tenant="RTS", columns={"n": "measure"}), "needs tenant"),
    (ROW, meta(model="platform_metrics", columns={"n": "measure"}), "no tenant"),
    (ROW, meta(tenant=None, columns={"n": "measure"}), "needs tenant"),
    ('EVALUATE ROW ( "n", COUNTROWS ( \'dim_person\' ) )\n', meta(columns={"n": "measure"}), "person key"),
    ('EVALUATE ROW ( "n", {{x}} )\n', meta(columns={"n": "measure"}), "placeholders"),
    (ROW, meta(columns={"n": "measure"}, params={"x": {"type": "int", "min": 0, "max": 1}}), "placeholders"),
    ('EVALUATE ROW ( "n", {{env}} )\n', meta(columns={"n": "measure"}, params={"env": {"type": "enum", "values": ["PROD"]}}),
     "reserved"),
    ('EVALUATE ROW ( "n", {{x}} )\n', meta(columns={"n": "measure"}, params={"x": {"type": "regex"}}), "unknown type"),
    ('EVALUATE ROW ( "n", {{x}} )\n', meta(columns={"n": "measure"}, params={"x": {"type": "enum", "values": ['a"b']}}),
     "simple strings"),
    ('EVALUATE ROW ( "n", {{x}} )\n', meta(columns={"n": "measure"}, params={"x": {"type": "int", "min": 5, "max": 1}}),
     "min <= max"),
    ('EVALUATE ROW ( "n", {{x_filter}} )\n',
     meta(columns={"n": "measure"}, params={"x": {"type": "sk", "filter_column": "dim_x[a]) EVALUATE"}}), "filter_column"),
    ('EVALUATE ROW ( "n", {{date_from}} )\n', meta(columns={"n": "measure"}, params={"window": {"type": "date_window"}}),
     "named dates"),
    ('SELECT 1\n', meta(columns={"n": "measure"}), "EVALUATE or DEFINE"),
    (ROW, "{not json", "not JSON"),
])
def test_startup_self_check_refuses_bad_definitions(tmp_path, dax, roles, msg):
    if isinstance(roles, dict) and roles.get("tenant") is None and "tenant" in roles:
        roles = {k: v for k, v in roles.items() if k != "tenant"}
    d = write_query(tmp_path / "q", "ac1", "bad", dax, roles)
    with pytest.raises(Q.QueryDefinitionError, match=msg):
        Q.load_queries(d)


def test_missing_roles_file_and_orphan_roles_file(tmp_path):
    d = tmp_path / "q"
    write_query(d, "ac1", "ok", ROW, meta(columns={"n": "measure"}))
    (d / "ac1" / "ok.roles.json").unlink()
    with pytest.raises(Q.QueryDefinitionError, match="missing ok.roles.json"):
        Q.load_queries(d)
    (d / "ac1" / "ok.dax").unlink()
    (d / "ac1" / "orphan.roles.json").write_text("{}", encoding="utf-8")
    with pytest.raises(Q.QueryDefinitionError, match="without a .dax"):
        Q.load_queries(d)


def test_tenant_subfolder_must_match_declared_tenant(tmp_path):
    d = write_query(tmp_path / "q", "ac2", "cc/x", ROW, meta(columns={"n": "measure"}))      # declares RTS
    with pytest.raises(Q.QueryDefinitionError, match="under cc/"):
        Q.load_queries(d)


def test_create_app_refuses_to_start_on_a_bad_definition(tmp_path):
    from app.main import create_app
    d = write_query(tmp_path / "q", "ac8", "bad", 'EVALUATE ROW ( "person_name", 1 )\n',
                    meta(model="leitstelle_olten", tenant="CARGOCONTROL", columns={"person_name": "code"}))
    with pytest.raises(Q.QueryDefinitionError):
        create_app(client=make_client(Upstream((200, ok_body([])))), queries_dir=d)


def test_real_query_tree_loads():
    reg = Q.load_queries()
    # a superset, not a count: every new showcase broke the exact set (core request ac4 #2 / ac7 #1)
    assert {"ac1", "ac2", "ac8", "metrics", "ac4", "ac10", "ac6"} <= set(reg) == set(Q.SHOWCASES)
    for sc, qs in reg.items():
        for q in qs.values():
            assert q.columns and q.meta.get("replaces") and q.meta.get("view") and q.meta.get("grain"), f"{sc}/{q.qid}"


# ----------------------------------------------------------------------- typed params

P = {"env": "PROD", "audience": "ausbilder"}


@pytest.mark.parametrize("params", [
    {"env": "PROD"},                                                         # audience required
    {**P, "audience": "Ausbilder"},
    {**P, "audience": 'ausbilder" ) EVALUATE ROW ( "x", 1 ) //'},
    {**P, "hour": "24"}, {**P, "hour": "-1"}, {**P, "hour": "7.5"}, {**P, "hour": "1e3"},
    {**P, "day": "2026-1-1"}, {**P, "day": "2026-02-30"}, {**P, "day": "2026-10-20T00:00:00"},
    {**P, "month": "2026-13"}, {**P, "month": "2026-1"}, {**P, "month": "2026-10-01"},
    {**P, "qual": "short"}, {**P, "qual": 'x" } , ALL ( dim_person ) ) EVALUATE ROW ( "x", 1 ) //'},
    {**P, "depot": "a'b" + "c" * 20},
    {**P, "person": "P-123"},
    {**P, "planungsmonat": "2026-10"},
])
def test_typed_params_reject(qdir, params):
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up, queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/params", params=params)
    assert r.status_code == 400, r.text
    assert up.requests == []


def test_render_literals_defaults_and_absent_filters(qdir):
    reg = Q.load_queries(qdir)
    q = reg["ac1"]["params"]
    m = Masker(real=False)
    sel = Q.Selection("RTS", "PROD")
    p = Q.validate(q, {"audience": "auszubildende"}, sel, m, today=TODAY)
    assert p == {"audience": "auszubildende", "day": TODAY}
    dax = Q.render(q, p, sel, m)
    assert '"auszubildende"' in dax and "DATE ( 2026, 10, 20 )" in dax
    assert "ALL ( 'dim_person'[person_sk] )" in dax and "ALL ( 'dim_depot'[depot_sk] )" in dax
    assert dax.count("BLANK ()") == 3                                       # hour, month, qual absent
    p2 = Q.validate(q, {"audience": "ausbilder", "hour": "7", "month": "2026-02", "qual": "c" * 64,
                        "depot": "d" * 16, "day": "2026-11-03"}, sel, m, today=TODAY)
    dax2 = Q.render(q, p2, sel, m)
    assert '"n", 7,' in dax2 and "DATE ( 2026, 2, 1 )" in dax2 and "DATE ( 2026, 11, 3 )" in dax2
    assert f'"{"c" * 64}"' in dax2 and f'TREATAS ( {{ "{"d" * 16}" }}, \'dim_depot\'[depot_sk] )' in dax2


@pytest.mark.parametrize("raw, expect", [
    ({}, (dt.date(2026, 9, 20), TODAY)),
    ({"date_to": "2026-10-01"}, (dt.date(2026, 9, 1), dt.date(2026, 10, 1))),
    ({"date_from": "2026-10-01", "date_to": "2026-10-01"}, (dt.date(2026, 10, 1), dt.date(2026, 10, 1))),
])
def test_date_window_to_today(qdir, raw, expect):
    q = Q.load_queries(qdir)["ac1"]["window"]
    p = Q.validate(q, dict(raw), Q.Selection("RTS", "PROD"), Masker(real=False), today=TODAY)
    assert (p["date_from"], p["date_to"]) == expect


@pytest.mark.parametrize("raw", [
    {"date_from": "2026-10-21", "date_to": "2026-10-20"},
    {"date_from": "2024-01-01", "date_to": "2026-10-20"},
    {"date_from": "20261001"},
])
def test_date_window_rejects(qdir, raw):
    q = Q.load_queries(qdir)["ac1"]["window"]
    with pytest.raises(Q.ParamError):
        Q.validate(q, dict(raw), Q.Selection("RTS", "PROD"), Masker(real=False), today=TODAY)


def test_queries_endpoint_lists_params_and_roles(qdir):
    app, _ = make_app(Upstream((200, ok_body([]))), queries_dir=qdir)
    with TestClient(app) as c:
        body = c.get("/api/ac1/queries").json()
        ac2 = c.get("/api/ac2/queries").json()
    names = {q["id"]: q for q in body["queries"]}
    assert {p["name"] for p in names["params"]["params"]} == {"env", "person", "depot", "audience", "hour", "day",
                                                              "month", "qual"}
    assert names["notes"]["columns"]["beschreibung"] == "label_freetext"
    assert names["notes"]["columns"]["tn_count"] == "measure"              # derived columns listed too
    assert {p["name"] for p in ac2["queries"][0]["params"]} == {"tenant", "env"}


# ----------------------------------------------------------------------- uuid param (option B, /metrics)

UUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"


def _uuid_query(tmp_path):
    d = write_query(tmp_path / "q", "metrics", "by_chain",
                    "EVALUATE SUMMARIZECOLUMNS ( 'f'[a], TREATAS ( { {{chain_id}} }, 'f'[run_id] ), \"n\", 1 )\n",
                    {"model": "platform_metrics", "replaces": "x", "view": "x", "grain": "x",
                     "params": {"chain_id": {"type": "uuid", "required": True}},
                     "columns": {"a": "label_technical", "n": "measure"}})
    return Q.load_queries(d)["metrics"]["by_chain"]


@pytest.mark.parametrize("val", ["not-a-uuid", UUID.upper(), UUID[:-1] + '"', UUID + "0",
                                 "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", '") EVALUATE ROW("x",1) //-----------'])
def test_uuid_param_rejects(tmp_path, val):
    q = _uuid_query(tmp_path)
    with pytest.raises(Q.ParamError):
        Q.validate(q, {"chain_id": val}, Q.Selection(None, None), Masker(real=False), today=TODAY)


def test_uuid_param_renders_a_literal(tmp_path):
    q = _uuid_query(tmp_path)
    sel, m = Q.Selection(None, None), Masker(real=False)
    dax = Q.render(q, Q.validate(q, {"chain_id": UUID}, sel, m, today=TODAY), sel, m)
    assert f'TREATAS ( {{ "{UUID}" }}, \'f\'[run_id] )' in dax
