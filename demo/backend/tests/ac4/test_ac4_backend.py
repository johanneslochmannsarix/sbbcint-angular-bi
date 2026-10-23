"""AC-4 offline tests: query definitions on sm_fico, roles, minimisation (no person column anywhere, tour name
masked as free text), F1 / F6 rules in the DAX, masking end to end, role coverage, param whitelist and the
server-side rendering of the filters. No Fabric, no az. Every name, key and free text below is an invented
fixture."""
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

AC4_DIR = Q.QUERIES_DIR / "ac4"
AC4 = Q.load_queries()["ac4"]
SK = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"

# --------------------------------------------------------------------------- fixtures (invented)

TOUR_NAME = "F Köln Hans Erfunden 42"
SECRETS = ["Hans", "Erfunden", TOUR_NAME]


def _dax_row(d: dict) -> dict:
    return {f"[{k}]": v for k, v in d.items()}


def tour_row(**kw) -> dict:
    r = {"element_id": "el-0001", "element_nr": 1, "taetigkeit": "Fahren Schweiz (Sys.)", "fahren": "ja",
         "element_planbeginn": "2026-09-10T06:00:00", "element_planende": "2026-09-10T08:00:00",
         "element_istbeginn": "2026-09-10T06:07:00", "element_istende": "2026-09-10T08:01:00",
         "plandauer_min": 120.0, "istdauer_min": 114.0, "startbahnhof": "Basel SBB RB", "zielbahnhof": "Chiasso",
         "person_zuordnung": "eingeteilt", "tour": TOUR_NAME, "tourstandort": "CINT (CH) Basel",
         "firma": "SBB Cargo International EVU Schweiz", "personaltyp_tour": "CINT (CH) - Lokführer National",
         "planmonat": "2026-09", "tour_planbeginn": "2026-09-10T05:30:00", "tour_planende": "2026-09-10T14:00:00",
         "tour_istbeginn": "2026-09-10T06:07:00", "tour_istende": "2026-09-10T08:01:00",
         "abdeckung": "alle Fahrelemente", "anger_min": 510.0}
    r.update(kw)
    return _dax_row(r)


def touren_row(**kw) -> dict:
    r = {"tour_id": SK, "tour": TOUR_NAME, "tour_plandatum": "2026-09-10T00:00:00",
         "tour_planbeginn": "2026-09-10T05:30:00", "tour_planende": "2026-09-10T14:00:00",
         "personaltyp_tour": "CINT (CH) - Lokführer National", "abdeckung": "teilweise", "anger_min": None,
         "tourelemente": 12, "plandauer_h": 8.5, "fahren_h": 2.0, "elemente_mit_ist": 1, "ist_erfassung": 0.08}
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

EXPECTED = {"stand", "dims", "monate", "standorte", "taetigkeiten", "personaltypen", "kalender", "jup", "plan_ist",
            "kommunikation_kpi", "kommunikation", "angerechnet", "angerechnet_hist", "touren", "tour"}


def test_ac4_queries_load_on_sm_fico_only():
    assert set(AC4) == EXPECTED
    for q in AC4.values():
        assert q.model == "fico" and q.tenant == "CARGOCONTROL", q.qid


def test_fico_dataset_is_cargocontrol_prod_and_qa():
    assert D.lookup("fico", "CARGOCONTROL", "PROD").dataset_id == "488fad6b-6417-4f7f-9d7b-b41ce1a49ff2"
    assert D.lookup("fico", "CARGOCONTROL", "QA").dataset_id == "fcbc592a-a112-4501-8786-c65471432b8c"


def test_every_ac4_dax_has_a_roles_file_a_view_and_what_it_replaces():
    for p in AC4_DIR.rglob("*.dax"):
        assert p.with_suffix(".roles.json").exists(), p.name
    for q in AC4.values():
        assert q.meta.get("view") and q.meta.get("grain") and q.meta.get("replaces"), q.qid


# --------------------------------------------------------------------------- minimisation

_PERSON_DAX = re.compile(
    r"\[\s*(Person|Vorname|Nachname|Personalnummer|person_sk|person_nk|Personalstandort|Person aktiv"
    r"|person_worker_type_ref|worker_team_ref|mainlocation_ref|mainlocation_tenant_ref)\s*\]", re.IGNORECASE)


def test_no_ac4_query_reads_a_person_column():
    hits = []
    for p in sorted(AC4_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        hits += [f"{p.name}: {m.group(0)}" for m in _PERSON_DAX.finditer(text)]
        hits += [f"{p.name}: dim_person" for _ in re.finditer("dim_person", text)]
        hits += [str(v) for v in forbidden.check_text("ac4", text, p.name)]
    assert hits == []


def test_no_ac4_query_returns_a_person_label():
    for q in AC4.values():
        assert not q.person_keys, q.qid
        assert not [c for c, r in q.roles.items() if r == "label_person"], q.qid
        assert not set(q.roles) & PERSON_COLUMNS, q.qid
        for c in set(q.roles) & FREETEXT_COLUMNS:
            assert q.roles[c] == "label_freetext", (q.qid, c)


def test_tour_name_is_free_text_wherever_it_is_returned():
    returning = [q.qid for q in AC4.values() if "tour" in q.roles]
    assert sorted(returning) == ["tour", "touren"]
    for qid in returning:
        assert AC4[qid].roles["tour"] == "label_freetext", qid


def test_element_name_is_never_read():
    for p in sorted(AC4_DIR.rglob("*.dax")):
        assert "[Tourelement]" not in p.read_text(encoding="utf-8"), p.name


def test_firma_is_the_tourstandort_company_and_no_auftrag_path():
    """F1: the element tenant (tenant_sk / tenant_nk) is never read; F6: no Auftrag / order reference."""
    for p in sorted(AC4_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        for bad in ("tenant_sk", "tenant_nk", "dispositionorderref_id", "dispositionorderitemshiftcomponentref_id"):
            assert bad not in text, (p.name, bad)


def test_angerechnete_zeit_is_never_summed_over_elements():
    """F3: a tour attribute repeated per element - only MAX per tour_id, never SUM over the column."""
    for p in sorted(AC4_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        assert not re.search(r"SUM\s*\(\s*fico_disposition\[Tour angerechnete Zeit", text), p.name
        for m in re.finditer(r"(\w+)\s*\(\s*fico_disposition\[Tour angerechnete Zeit \(min\)\]", text):
            assert m.group(1) in ("MAX", "ISBLANK"), (p.name, m.group(1))


def test_planung_and_disposition_are_never_grouped_together():
    """F10: no relationship - a query may map a filter value via fico_disposition, but groups one table only."""
    for qid in ("jup", "kommunikation", "kommunikation_kpi"):
        body = AC4[qid].body
        group = body[body.index("SUMMARIZECOLUMNS"):]
        group = group[: group.index('"')]
        assert "fico_disposition[" not in group, qid


def test_no_epoch_companion_or_foreign_schema():
    for p in sorted(AC4_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8").lower()
        assert "_timezone" not in text and "loclocation" not in text, p.name


# --------------------------------------------------------------------------- masking end to end

def test_touren_masks_the_tour_name():
    c, _ = client_for((200, ok_body([touren_row()])))
    r = c.get(f"/api/ac4/q/touren?env=PROD&month=2026-09&standort={SK}")
    assert r.status_code == 200, r.text
    body = r.json()
    no_secret(body)
    assert TEXT_TOKEN_RE.match(body["rows"][0]["tour"])
    assert body["mode"] == "masked" and body["person_keys"] == []


def test_tour_masks_the_name_but_keeps_stations_and_activities():
    c, _ = client_for((200, ok_body([tour_row(), tour_row(element_nr=2, element_istbeginn=None, element_istende=None)])))
    body = c.get(f"/api/ac4/q/tour?env=PROD&tour={SK}").json()
    no_secret(body)
    rows = body["rows"]
    assert rows[0]["tour"] == rows[1]["tour"] and TEXT_TOKEN_RE.match(rows[0]["tour"])
    assert rows[0]["startbahnhof"] == "Basel SBB RB" and rows[0]["taetigkeit"] == "Fahren Schweiz (Sys.)"
    assert rows[1]["element_istbeginn"] is None                     # no Ist stays empty, never filled


def test_real_mode_shows_the_tour_name():
    c, _ = client_for((200, ok_body([touren_row()])), masker=Masker(real=True))
    body = c.get(f"/api/ac4/q/touren?env=PROD&month=2026-09&standort={SK}").json()
    assert body["mode"] == "real" and body["rows"][0]["tour"] == TOUR_NAME


def test_undeclared_column_is_refused_with_502():
    row = touren_row()
    row["[Personalnummer]"] = "123456"
    c, _ = client_for((200, ok_body([row])))
    r = c.get(f"/api/ac4/q/touren?env=PROD&month=2026-09&standort={SK}")
    assert r.status_code == 502
    assert "123456" not in r.text and "Erfunden" not in r.text


def test_missing_declared_column_is_refused_with_502():
    row = touren_row()
    del row["[abdeckung]"]
    c, _ = client_for((200, ok_body([row])))
    assert c.get(f"/api/ac4/q/touren?env=PROD&month=2026-09&standort={SK}").status_code == 502


# --------------------------------------------------------------------------- params

@pytest.mark.parametrize("url", [
    "/api/ac4/q/touren?env=PROD&standort=" + SK,                         # month required
    "/api/ac4/q/touren?env=PROD&month=2026-09",                          # standort required
    "/api/ac4/q/tour?env=PROD",                                          # tour required
    "/api/ac4/q/tour?env=PROD&tour=x'y",                                 # sk pattern
    "/api/ac4/q/monate?env=PROD&firma=SBB%20Cargo%20International",      # the element tenant is not a Firma (F1)
    "/api/ac4/q/monate?env=PROD&firma=sbb%20cargo%20italia",             # enum is exact
    "/api/ac4/q/monate?env=PROD&ptyp=0",                                 # int range
    "/api/ac4/q/monate?env=PROD&ptyp=CD%20-%20Lokf%C3%BChrer",           # a name, not a rank
    "/api/ac4/q/monate?env=PROD&month=2026-09",                          # monate is per month: no month param
    "/api/ac4/q/standorte?env=PROD&month=2026-13",                       # month
    "/api/ac4/q/standorte?env=PROD&person=P-abcdef",                     # no person param in AC-4
    "/api/ac4/q/plan_ist?env=PROD&auftrag=1",                            # not whitelisted
    "/api/ac4/q/stand?env=DEV",                                          # env
    "/api/ac4/q/stand?env=PROD&tenant=RTS",                              # sm_fico is CargoControl only
])
def test_param_whitelist(url):
    c, up = client_for((200, ok_body([])))
    assert c.get(url).status_code == 400
    assert up.requests == []                                             # refused before any call to Fabric


def test_unfiltered_request_sends_blanks():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac4/q/monate?env=PROD").status_code == 200
    sent = up.sent_query()
    for var in ("_firma", "_st", "_pt", "_ta"):
        assert f"VAR {var} = BLANK ()" in sent, var


def test_filters_render_as_literals_server_side():
    c, up = client_for((200, ok_body([])))
    url = f"/api/ac4/q/plan_ist?env=QA&month=2026-09&firma=SBB%20Cargo%20Italia&standort={SK}&ptyp=7&taet={SK}"
    assert c.get(url).status_code == 200
    sent = up.sent_query()
    assert "VAR _m = DATE ( 2026, 9, 1 )" in sent
    assert 'VAR _firma = "SBB Cargo Italia"' in sent
    assert f'VAR _st = "{SK}"' in sent and f'VAR _ta = "{SK}"' in sent
    assert "VAR _pt = 7" in sent
    assert str(up.requests[0].url) == D.lookup("fico", "CARGOCONTROL", "QA").url


def test_tour_filter_is_a_treatas_on_the_tour_id():
    c, up = client_for((200, ok_body([])))
    assert c.get(f"/api/ac4/q/tour?env=PROD&tour={SK}").status_code == 200
    sent = up.sent_query()
    assert f'VAR _tour = "{SK}"' in sent and "TREATAS ( { _tour }, fico_disposition[tour_id] )" in sent


def test_ping():
    c, _ = client_for((200, ok_body([])))
    assert c.get("/api/ac4/ping").json() == {"showcase": "ac4", "ok": True}
