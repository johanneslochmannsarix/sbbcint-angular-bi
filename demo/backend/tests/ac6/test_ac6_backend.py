"""AC-6 offline tests: query definitions on sm_fico / fico_planung, roles, minimisation (no person column, tour
name masked as free text, no element name), settled answers in the DAX (versions never summed, plan and
disposition never grouped together, the Schichtbildung 1 window fixed), masking end to end, role coverage, param
whitelist and the server-side rendering of the rank params. No Fabric, no az. Every name, key and free text below
is an invented fixture."""
from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient

from app.core import datasets as D
from app.core import forbidden
from app.core import queries as Q
from app.core.masking import FREETEXT_COLUMNS, PERSON_COLUMNS, TEXT_TOKEN_RE, Masker
from tests.support import Upstream, make_app, ok_body

AC6_DIR = Q.QUERIES_DIR / "ac6"
AC6 = Q.load_queries()["ac6"]
SK = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"

TOUR_NAME = "T Basel Hans Erfunden 7"
SECRETS = ["Hans", "Erfunden", TOUR_NAME]


def _dax_row(d: dict) -> dict:
    return {f"[{k}]": v for k, v in d.items()}


def touren_row(**kw) -> dict:
    r = {"tour_id": SK, "tour": TOUR_NAME, "personaltyp": "CINT (CH) - Lokführer National", "tag": 1,
         "start_ms": 108_000_000, "ende_ms": 140_400_000, "elemente": 9, "dauer_h": 9.0, "fahren_h": 3.5}
    r.update(kw)
    return _dax_row(r)


def tour_row(**kw) -> dict:
    r = {"element_id": "el-0001", "tour": TOUR_NAME, "version": "Schichtbildung 1", "tourstandort": "CINT (CH) Basel",
         "personaltyp": "CINT (CH) - Lokführer National", "tour_start_ms": 108_000_000, "tour_ende_ms": 140_400_000,
         "start_ms": 108_000_000, "ende_ms": 115_200_000, "dauer_min": 120.0, "arbeitszeit_min": 120.0,
         "taetigkeit": "Fahren Schweiz (Sys.)", "fahren": "ja", "startbahnhof": "Basel SBB RB", "zielbahnhof": "Chiasso",
         "zugnummer": "40123", "kostenallokation": "Zugfahrt"}
    r.update(kw)
    return _dax_row(r)


_OPEN: list[TestClient] = []


@pytest.fixture(autouse=True)
def _close_clients():
    yield
    while _OPEN:
        _OPEN.pop().__exit__(None, None, None)


def client_for(*answers, masker: Masker | None = None):
    up = Upstream(*answers)
    app, _ = make_app(up, masker=masker)
    c = TestClient(app)
    c.__enter__()
    _OPEN.append(c)
    return c, up


def no_secret(payload: dict) -> None:
    text = json.dumps(payload, ensure_ascii=False)
    for s in SECRETS:
        assert s not in text, s


# --------------------------------------------------------------------------- definitions

EXPECTED = {"stand", "dims", "kpi", "heatmap", "hierarchy", "woche", "diff", "vergleich", "vergleich_wochen",
            "kosten", "touren", "tour"}


def test_ac6_queries_load_on_sm_fico_only():
    assert set(AC6) == EXPECTED
    for q in AC6.values():
        assert q.model == "fico" and q.tenant == "CARGOCONTROL", q.qid


def test_fico_dataset_is_cargocontrol_prod_and_qa():
    assert D.lookup("fico", "CARGOCONTROL", "PROD").dataset_id == "488fad6b-6417-4f7f-9d7b-b41ce1a49ff2"
    assert D.lookup("fico", "CARGOCONTROL", "QA").dataset_id == "fcbc592a-a112-4501-8786-c65471432b8c"


def test_every_ac6_dax_has_a_roles_file_a_view_and_what_it_replaces():
    for p in AC6_DIR.rglob("*.dax"):
        assert p.with_suffix(".roles.json").exists(), p.name
    for q in AC6.values():
        assert q.meta.get("view") and q.meta.get("grain") and q.meta.get("replaces"), q.qid


# --------------------------------------------------------------------------- minimisation

_PERSON_DAX = re.compile(
    r"\[\s*(Person|Vorname|Nachname|Personalnummer|person_sk|person_nk|Personalstandort|Person aktiv|Person Zuordnung"
    r"|person_worker_type_ref|worker_team_ref|mainlocation_ref|mainlocation_tenant_ref)\s*\]", re.IGNORECASE)


def test_no_ac6_query_reads_a_person_column():
    hits = []
    for p in sorted(AC6_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        hits += [f"{p.name}: {m.group(0)}" for m in _PERSON_DAX.finditer(text)]
        hits += [f"{p.name}: dim_person" for _ in re.finditer("dim_person", text)]
        hits += [str(v) for v in forbidden.check_text("ac6", text, p.name)]
    assert hits == []


def test_no_ac6_query_returns_a_person_label():
    for q in AC6.values():
        assert not q.person_keys, q.qid
        assert not [c for c, r in q.roles.items() if r == "label_person"], q.qid
        assert not set(q.roles) & PERSON_COLUMNS, q.qid
        for c in set(q.roles) & FREETEXT_COLUMNS:
            assert q.roles[c] == "label_freetext", (q.qid, c)


def test_tour_name_is_free_text_wherever_it_is_returned():
    returning = sorted(q.qid for q in AC6.values() if "tour" in q.roles)
    assert returning == ["tour", "touren"]
    for qid in returning:
        assert AC6[qid].roles["tour"] == "label_freetext", qid


def test_element_name_and_epoch_companions_are_never_read():
    for p in sorted(AC6_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        assert "[Tourelement]" not in text, p.name
        assert "_timezone" not in text.lower() and "loclocation" not in text.lower(), p.name


def test_no_classification_and_no_km():
    """ADR-046: the demo classifies nothing; S5: there is no km column."""
    for p in sorted(AC6_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8").lower()
        for bad in ("kernleistung", "reserve", "entfernung", "_km", "taetigkeitstyp", "planungsdomaene"):
            assert bad not in text, (p.name, bad)


def test_tour_attributes_are_never_summed_over_elements():
    """Tour Dauer and angerechnete Zeit repeat on every element: never SUM them."""
    for p in sorted(AC6_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        assert not re.search(r"SUM\s*\(\s*fico_planung\[Tour (Dauer|angerechnete)", text), p.name


def test_every_version_view_filters_one_version():
    """Versions are never summed: a query that groups plan measures takes the version param (or pins one name),
    except kosten and dims, which group BY version."""
    for qid, q in AC6.items():
        if qid in ("stand", "dims", "kosten", "tour"):
            continue
        if qid.startswith("vergleich"):
            assert 'fico_planung[JUP Version] = "Schichtbildung 1"' in q.body, qid
            continue
        assert "version" in q.params and q.params["version"].required, qid
    body = AC6["kosten"].body
    assert "fico_planung[JUP Version]," in body and "NOT ISBLANK ( fico_planung[JUP Version] )" in body


def test_plan_and_disposition_are_two_aggregates_never_grouped_together():
    """No relationship between the tables: no SUMMARIZECOLUMNS groups columns of both; only vergleich* and stand
    read fico_disposition at all."""
    readers = sorted(q.qid for q in AC6.values() if "fico_disposition[" in q.body)
    assert readers == ["stand", "vergleich", "vergleich_wochen"]
    for qid in readers:
        for m in re.finditer(r"SUMMARIZECOLUMNS\s*\((.*?)\"@", AC6[qid].body, re.S):
            group = m.group(1)
            assert not ("fico_planung[" in group and "fico_disposition[" in group), qid


def test_comparison_window_is_the_settled_schichtbildung_period():
    for qid in ("vergleich", "vergleich_wochen"):
        body = AC6[qid].body
        assert "DATE ( 2026, 9, 7 )" in body and "DATE ( 2026, 12, 12 )" in body, qid


def test_kostenstelle_note_uses_the_model_rows():
    body = AC6["kosten"].body
    assert "Kostenallokation Code] = 3" in body and "ISBLANK ( fico_planung[kostenstelle_id] )" in body


# --------------------------------------------------------------------------- masking end to end

def test_touren_masks_the_tour_name():
    c, _ = client_for((200, ok_body([touren_row()])))
    r = c.get("/api/ac6/q/touren?env=PROD&version=11&standort=3")
    assert r.status_code == 200, r.text
    body = r.json()
    no_secret(body)
    assert TEXT_TOKEN_RE.match(body["rows"][0]["tour"])
    assert body["mode"] == "masked" and body["person_keys"] == []


def test_tour_masks_the_name_but_keeps_stations_and_activities():
    c, _ = client_for((200, ok_body([tour_row(), tour_row(element_id="el-0002", zugnummer=None)])))
    body = c.get(f"/api/ac6/q/tour?env=PROD&tour={SK}").json()
    no_secret(body)
    rows = body["rows"]
    assert rows[0]["tour"] == rows[1]["tour"] and TEXT_TOKEN_RE.match(rows[0]["tour"])
    assert rows[0]["startbahnhof"] == "Basel SBB RB" and rows[0]["taetigkeit"] == "Fahren Schweiz (Sys.)"
    assert rows[1]["zugnummer"] is None


def test_real_mode_shows_the_tour_name():
    c, _ = client_for((200, ok_body([touren_row()])), masker=Masker(real=True))
    body = c.get("/api/ac6/q/touren?env=PROD&version=11&standort=3").json()
    assert body["mode"] == "real" and body["rows"][0]["tour"] == TOUR_NAME


def test_undeclared_column_is_refused_with_502():
    row = touren_row()
    row["[Personalnummer]"] = "123456"
    c, _ = client_for((200, ok_body([row])))
    r = c.get("/api/ac6/q/touren?env=PROD&version=11&standort=3")
    assert r.status_code == 502
    assert "123456" not in r.text and "Erfunden" not in r.text


def test_missing_declared_column_is_refused_with_502():
    row = touren_row()
    del row["[fahren_h]"]
    c, _ = client_for((200, ok_body([row])))
    assert c.get("/api/ac6/q/touren?env=PROD&version=11&standort=3").status_code == 502


# --------------------------------------------------------------------------- params

@pytest.mark.parametrize("url", [
    "/api/ac6/q/kpi?env=PROD",                                           # version required
    "/api/ac6/q/kpi?env=PROD&version=Schichtbildung%201",                # a name, not a rank
    "/api/ac6/q/kpi?env=PROD&version=0",                                 # int range
    "/api/ac6/q/kpi?env=PROD&version=61",
    "/api/ac6/q/kpi?env=PROD&version=11&tag=2",                          # the band always shows the week
    "/api/ac6/q/diff?env=PROD&version=11",                               # version_b required
    "/api/ac6/q/hierarchy?env=PROD&version=11&tag=8",                    # weekday 0..7
    "/api/ac6/q/touren?env=PROD&version=11",                             # standort required
    "/api/ac6/q/tour?env=PROD",                                          # tour required
    "/api/ac6/q/tour?env=PROD&tour=x'y",                                 # sk pattern
    "/api/ac6/q/vergleich?env=PROD&version=10",                          # the comparison is Schichtbildung 1 only
    "/api/ac6/q/heatmap?env=PROD&version=11&person=P-abcdef",            # no person param in AC-6
    "/api/ac6/q/kosten?env=PROD&firma=SBB%20Cargo%20Italia",             # firma is a rank
    "/api/ac6/q/stand?env=DEV",                                          # env
    "/api/ac6/q/stand?env=PROD&tenant=RTS",                              # sm_fico is CargoControl only
])
def test_param_whitelist(url):
    c, up = client_for((200, ok_body([])))
    assert c.get(url).status_code == 400
    assert up.requests == []                                             # refused before any call to Fabric


def test_unfiltered_request_sends_blanks():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac6/q/kpi?env=PROD&version=11").status_code == 200
    sent = up.sent_query()
    assert "VAR _v = 11" in sent
    for var in ("_f", "_s", "_p", "_t"):
        assert f"VAR {var} = BLANK ()" in sent, var


def test_rank_params_render_as_integers_server_side():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac6/q/diff?env=QA&version=11&version_b=10&firma=2&tag=0").status_code == 200
    sent = up.sent_query()
    assert "VAR _a = 11" in sent and "VAR _b = 10" in sent and "VAR _f = 2" in sent and "VAR _d = 0" in sent
    assert "fico_planung[musterwochentag_nr] == _d" in sent           # strict: Monday (0) is not BLANK
    assert str(up.requests[0].url) == D.lookup("fico", "CARGOCONTROL", "QA").url


def test_tour_filter_is_a_treatas_on_the_tour_id():
    c, up = client_for((200, ok_body([])))
    assert c.get(f"/api/ac6/q/tour?env=PROD&tour={SK}").status_code == 200
    assert f'TREATAS ( {{ "{SK}" }}, fico_planung[tour_id] )' in up.sent_query()


def test_ping():
    c, _ = client_for((200, ok_body([])))
    assert c.get("/api/ac6/ping").json() == {"showcase": "ac6", "ok": True}
