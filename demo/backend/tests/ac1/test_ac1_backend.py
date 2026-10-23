"""AC-1 offline tests: query definitions, plan-only rule, tag parser, masking of the parsed tags, role
coverage, location join. No Fabric, no az. Every name and free text below is an invented fixture."""
from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient

from app.core import forbidden
from app.core import queries as Q
from app.core.bronze import FORBIDDEN_COLUMNS, forbidden_column
from app.core.masking import Masker
from app.showcases.ac1 import locations, tags
from tests.support import FakeOpener, Upstream, fake_bronze, make_app, ok_body

AC1_DIR = Q.QUERIES_DIR / "ac1"
AC1 = Q.load_queries()["ac1"]

# --------------------------------------------------------------------------- fixtures (invented)

PEOPLE = [
    {"person_sk": "sk-trainer-0001", "person_name": "Hugo Probemann", "firstname": "Hugo", "lastname": "Probemann", "audience": "ausbilder"},
    {"person_sk": "sk-trainee-0001", "person_name": "Lena Fiktiv", "firstname": "Lena", "lastname": "Fiktiv", "audience": "auszubildende"},
    {"person_sk": "sk-trainee-0002", "person_name": "Jonas Fiktiv", "firstname": "Jonas", "lastname": "Fiktiv", "audience": "auszubildende"},
    {"person_sk": "sk-trainee-0003", "person_name": "Mia Erfunden", "firstname": "Mia", "lastname": "Erfunden", "audience": "auszubildende"},
]
KOMMENTAR = "ALP: Probemann\nPrüfer: Gast Extern\nTN: Fiktiv, Lena; Erfunden / Zorro Unbekannt"
SECRETS = ["Hugo", "Probemann", "Lena", "Fiktiv", "Jonas", "Mia", "Erfunden", "Gast Extern", "Zorro", "Unbekannt",
           "sk-trainer-0001", "sk-trainee-0001", "sk-trainee-0002", "sk-trainee-0003"]


def _dax_row(d: dict) -> dict:
    return {f"[{k}]": v for k, v in d.items()}


def day_tags_upstream_rows() -> list[dict]:
    tag = {"kind": "tag", "person_sk": "sk-trainer-0001", "tourbezeichnung": "Prüfung BR 189",
           "start_time": "2026-10-09T08:00:00", "kommentar": KOMMENTAR, "person_name": None, "firstname": None,
           "lastname": None, "audience": None}
    people = [{"kind": "person", "tourbezeichnung": None, "start_time": None, "kommentar": None, **p} for p in PEOPLE]
    return [_dax_row(r) for r in [tag, *people]]


# --------------------------------------------------------------------------- definitions

def test_ac1_queries_load_with_roles():
    assert {"persons", "period_tours", "day_tours", "day_tags", "data_as_of", "months", "location_names"} <= set(AC1)
    for q in AC1.values():
        assert q.columns, q.qid
        assert q.tenant == "RTS" and q.model == "import"      # RT&S only, never inferred from CC


def test_free_text_and_person_columns_are_masked_roles():
    for q in AC1.values():
        for col, role in q.roles.items():
            if col in ("kommentar", "beschreibung", "dor_creator", "tag_name"):
                assert role == "label_freetext", (q.qid, col)
            if col in ("person_sk", "person_name", "firstname", "lastname", "linked_sk"):
                assert role == "label_person", (q.qid, col)


def test_every_ac1_dax_has_a_roles_file():
    for p in AC1_DIR.rglob("*.dax"):
        assert p.with_suffix(".roles.json").exists(), p.name


# --------------------------------------------------------------------------- plan only (HARD RULE)

# executed / IST times plus the columns that are not the plan window or not the calendar period
_NOT_IN_APP = re.compile(r"executed|\bist_|actual|_epoch\b|start_time_epoch|end_time_epoch|_ingested_at"
                         r"|date_basis|planungsmonat|auftragsende", re.IGNORECASE)


def test_plan_only_grep_over_ac1_dax():
    hits = []
    for p in sorted(AC1_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        hits += [f"{p.name}: {m.group(0)}" for m in _NOT_IN_APP.finditer(text)]
        hits += [str(v) for v in forbidden.check_text("ac1", text, p.name)]
    assert hits == []


def test_plan_only_rule_is_wired_in_the_core():
    assert forbidden.check_text("ac1", "EVALUATE ROW ( \"x\", MAX ( 'f'[executed_start] ) )")
    assert forbidden.check_text("ac1", "'f'[ist_beginn]")


# --------------------------------------------------------------------------- tag parser

def test_parse_splits_tags_and_people():
    got = tags.parse(KOMMENTAR)
    assert got == [("ALP", "Probemann"), ("PRUEFER", "Gast Extern"), ("TN", "Fiktiv, Lena"), ("TN", "Erfunden"),
                   ("TN", "Zorro Unbekannt")]
    assert tags.parse("TN:") == [("TN", "")]
    assert tags.parse(None) == [] and tags.parse("keine Marke hier") == []
    assert tags.parse("tn: Fiktiv und Erfunden") == [("TN", "Fiktiv"), ("TN", "Erfunden")]


def test_resolve_exactly_one_or_nothing():
    d = tags.Directory(PEOPLE)
    assert d.resolve("TN", "Fiktiv, Lena")[:2] == ("one", "sk-trainee-0001")
    assert d.resolve("TN", "Fiktiv")[0] == "several"            # two trainees share the surname: never guessed
    assert d.resolve("TN", "Zorro Unbekannt") == ("none", None, None)
    assert d.resolve("ALP", "Probemann") == ("one", "sk-trainer-0001", "ausbilder")


def test_comma_parts_resolve_when_the_whole_does_not():
    d = tags.Directory(PEOPLE)
    out = tags._resolve_name(d, "TN", "Erfunden, Gast")
    assert [(n, m) for n, m, _, _ in out] == [("Erfunden", "one"), ("Gast", "none")]


def test_tag_rows_shape():
    rows = tags.tag_rows([{k.strip("[]"): v for k, v in r.items()} for r in day_tags_upstream_rows()], {})
    assert [(r["tag"], r["match"]) for r in rows] == [("ALP", "one"), ("PRUEFER", "none"), ("TN", "one"), ("TN", "one"),
                                                      ("TN", "none")]
    assert all(set(r) == {"person_sk", "tourbezeichnung", "start_time", "tag", "tag_index", "tag_name", "linked_sk",
                          "linked_audience", "match"} for r in rows)


# --------------------------------------------------------------------------- endpoints + masking

def _client(upstream, **kw):
    app, _ = make_app(upstream, **kw)
    return TestClient(app)


def test_day_tags_masked_no_original_string_survives():
    up = Upstream((200, ok_body(day_tags_upstream_rows())))
    with _client(up) as c:
        r = c.get("/api/ac1/day_tags", params={"env": "PROD", "day": "2026-10-09"})
    assert r.status_code == 200
    body = r.json()
    text = json.dumps(body, ensure_ascii=False)
    for s in SECRETS + [KOMMENTAR]:
        assert s not in text, s
    assert "kommentar" not in body["columns"] and "person_name" not in body["columns"]
    for row in body["rows"]:
        assert row["tag_name"] is None or row["tag_name"].startswith("T-")
        assert row["linked_sk"] is None or row["linked_sk"].startswith("P-")
        assert row["person_sk"].startswith("P-")
    linked = [r for r in body["rows"] if r["match"] == "one"]
    assert {r["linked_audience"] for r in linked} >= {"auszubildende", "ausbilder"}
    assert "DATE ( 2026, 10, 9 )" in up.sent_query()


def test_same_person_same_pseudonym_across_queries():
    persons = [_dax_row({"person_sk": p["person_sk"], "person_name": p["person_name"], "audience": p["audience"],
                         "tour_days": 3}) for p in PEOPLE]
    up = Upstream((200, ok_body(persons)), (200, ok_body(day_tags_upstream_rows())))
    with _client(up, masker=Masker(real=False)) as c:
        ps = c.get("/api/ac1/q/persons", params={"env": "PROD"}).json()["rows"]
        tg = c.get("/api/ac1/day_tags", params={"env": "PROD", "day": "2026-10-09"}).json()["rows"]
    trainer = next(p["person_sk"] for p in ps if p["audience"] == "ausbilder")
    assert all(p["person_name"] == p["person_sk"] for p in ps)     # masked label = the pseudonym
    assert trainer in {r["person_sk"] for r in tg}
    assert trainer in {r["linked_sk"] for r in tg if r["tag"] == "ALP"}


def test_day_tours_free_text_masked_location_kept():
    row = _dax_row({"person_sk": "sk-trainee-0002", "tourbezeichnung": "Berufsschule", "zugnummer": None,
                    "start_time": "2026-10-09T08:00:00", "end_time": "2026-10-09T16:00:00", "start_location": "Muttenz",
                    "end_location": "Muttenz", "kommentar": "mit Jonas Fiktiv", "dor_name": "RTS TR_EiB2099 2026-10",
                    "activity_group": None, "label_de": None, "n": 1})
    with _client(Upstream((200, ok_body([row])))) as c:
        body = c.get("/api/ac1/q/day_tours", params={"env": "QA", "day": "2026-10-09"}).json()
    out = body["rows"][0]
    assert out["kommentar"].startswith("T-") and "Jonas" not in json.dumps(body)
    assert out["start_location"] == "Muttenz" and out["dor_name"] == "RTS TR_EiB2099 2026-10"
    assert body["mode"] == "masked"


def test_undeclared_column_is_refused_502():
    row = _dax_row({"person_sk": "sk-trainee-0002", "date": "2026-10-09T00:00:00", "tourbezeichnung": "x",
                    "start_time": None, "end_time": None, "dor_name": None, "activity_group": None, "n": 1,
                    "personnelnumber": "4711"})
    with _client(Upstream((200, ok_body([row])))) as c:
        r = c.get("/api/ac1/q/period_tours", params={"env": "PROD", "date_from": "2026-10-01", "date_to": "2026-10-31"})
    assert r.status_code == 502 and "4711" not in r.text


def test_params_are_whitelisted():
    with _client(Upstream((200, ok_body([])))) as c:
        assert c.get("/api/ac1/q/day_tours", params={"env": "PROD"}).status_code == 400            # day required
        assert c.get("/api/ac1/q/day_tours", params={"env": "PROD", "day": "2026-10-09", "x": "1"}).status_code == 400
        assert c.get("/api/ac1/q/period_tours", params={"env": "PROD", "date_from": "2026-01-01",
                                                         "date_to": "2026-06-01"}).status_code == 400   # > 62 days
        assert c.get("/api/ac1/q/day_tours", params={"env": "DEV", "day": "2026-10-09"}).status_code == 400


def test_raw_day_tags_route_is_refused():
    with _client(Upstream((200, ok_body([])))) as c:
        assert c.get("/api/ac1/q/day_tags", params={"env": "PROD", "day": "2026-10-09"}).status_code == 404


# --------------------------------------------------------------------------- locations

BRONZE = [
    {"id": "1", "name": "Muttenz", "latitude": "47.53", "longitude": "7.63"},
    {"id": "2", "name": "Basel", "latitude": "47.5", "longitude": "7.6"},
    {"id": "3", "name": "Basel", "latitude": "47.6", "longitude": "7.7"},                 # ambiguous
    {"id": "4", "name": "Olten Rbf", "latitude": "47.35", "longitude": "7.9"},
    {"id": "5", "name": "Olten Rbf", "latitude": "47.35", "longitude": "7.9"},             # same point -> ok
    {"id": "6", "name": "Ohne", "latitude": "", "longitude": None},
    {"id": "7", "name": "Musterweg 12", "latitude": "47.0", "longitude": "8.0"},            # address-like
    {"id": "8", "name": "Nicht referenziert", "latitude": "46.0", "longitude": "8.0"},
]


def test_location_join_statuses():
    ref = [{"location": n, "rows": i} for i, n in
           enumerate(["Muttenz", "Basel", "Olten Rbf", "Ohne", "Fehlt", "Musterweg 12"], 1)]
    joined = locations.join(ref, BRONZE)
    out = {e["name"]: e for e in joined}
    assert out["Muttenz"]["status"] == "ok" and out["Muttenz"]["lat"] == 47.53
    assert out["Basel"]["status"] == "ambiguous" and out["Basel"]["lat"] is None
    assert out["Olten Rbf"]["status"] == "ok" and out["Olten Rbf"]["kind"] == "station"
    assert out["Ohne"]["status"] == "no_coord"
    assert out["Fehlt"]["status"] == "absent"
    assert "Nicht referenziert" not in out
    withheld = [e for e in joined if e["status"] == "withheld"]
    assert len(withheld) == 1 and withheld[0]["name"] is None and withheld[0]["lat"] is None
    assert "Musterweg" not in json.dumps(joined)
    assert locations.coord("0", "0") is None and locations.coord("47,1", "7,9") == (47.1, 7.9)


def test_classify_by_name_only():
    assert locations.classify("Bahnhofstrasse 4") == "address_like"
    assert locations.classify("8600 Dübendorf") == "address_like"
    assert locations.classify("Basel Rbf") == "station"
    assert locations.classify("Muttenz") == "unclassified"


def test_address_columns_are_never_selected():
    assert not any(forbidden_column(c) for c in locations.BRONZE_COLUMNS)
    assert set(locations.BRONZE_COLUMNS) == {"id", "name", "latitude", "longitude"}
    probe = (Q.QUERIES_DIR.parent.parent / "probes" / "ac1").glob("*.py")
    for p in probe:
        text = p.read_text(encoding="utf-8")
        for col in FORBIDDEN_COLUMNS:
            assert f'"{col}"' not in text, (p.name, col)


def test_locations_endpoint_reads_only_rts_bronze_named_columns():
    opener = FakeOpener(BRONZE)
    names = [_dax_row({"location": "Muttenz", "rows": 5}), _dax_row({"location": "Fehlt", "rows": 1})]
    with _client(Upstream((200, ok_body(names))), bronze=fake_bronze(opener)) as c:
        r = c.get("/api/ac1/locations", params={"env": "QA"})
    assert r.status_code == 200
    body = r.json()
    assert {e["name"] for e in body["locations"]} == {"Muttenz", "Fehlt"}
    assert body["counts"] == {"ok": 1, "absent": 1}
    uri, opts = opener.calls[0]
    assert uri.endswith("/Tables/RTS_QA/public_abstractcustomlocation") and "LOCLOCATION" not in uri
