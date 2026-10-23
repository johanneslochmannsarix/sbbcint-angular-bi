"""AC-13 offline tests: query definitions on sm_nachbereitung_cd, roles, minimisation (no absence reason, no name or
personnel number, the AC-13 pseudonym only from its own dimension), the Q1 ruling (a) (no Standort × day query
returns «übrige» or «ohne Eintrag» on its own, the calendar paints tour / Ruhetag / Urlaub only), masking end to
end (the Gold label MA-… and the hidden key never leave the backend in masked mode), role coverage, param whitelist
and the server-side rendering of month / rank / pseudonym / tour params. No Fabric, no az. Every key, label and
tour number below is an invented fixture."""
from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient

from app.core import datasets as D
from app.core import forbidden
from app.core import queries as Q
from app.core.masking import FREETEXT_COLUMNS, PERSON_COLUMNS, PSEUDONYM_RE, TEXT_TOKEN_RE, Masker
from tests.support import Upstream, make_app, ok_body

AC13_DIR = Q.QUERIES_DIR / "ac13"
AC13 = Q.load_queries()["ac13"]
PERSON_SK = "f00dfeed" * 8
TOUR_SK = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"
KENNUNG = "MA-1A2B3C4D"
TOUR_NAME = "C9-KOE-7-11 Erfunden"
SECRETS = [PERSON_SK, KENNUNG, TOUR_NAME, "Erfunden"]

EXPECTED = {"stand", "dims", "monate", "standort_tage", "menge_grid", "az_box", "az_punkte", "ue_kanten", "ue_touren",
            "regeln", "tag_touren", "person_touren", "tour"}


def _dax_row(d: dict) -> dict:
    return {f"[{k}]": v for k, v in d.items()}


def grid_row(**kw) -> dict:
    r = {"person": PERSON_SK, "kennung": KENNUNG, "heimatstandort": "CD - Köln", "datum": "2026-09-03T00:00:00",
         "touren": 1, "uebernachtung": 0, "ruhe": 0, "urlaub": 0}
    r.update(kw)
    return _dax_row(r)


def ue_row(**kw) -> dict:
    r = {"tour": TOUR_SK, "person": PERSON_SK, "kennung": KENNUNG, "heimatstandort": "CD - Köln",
         "tourennummer": TOUR_NAME, "tour_standort": "CD - Köln", "datum": "2026-09-03T00:00:00",
         "plan_beginn": "2026-09-03T18:00:00", "plan_ende": "2026-09-04T02:00:00", "start": "KKAN", "ziel": "MMAN",
         "rolle": "Hinweg", "folgetour": 0, "ort": "MMAN", "partner_beginn": "2026-09-04T12:00:00",
         "partner_tourennummer": TOUR_NAME + " R", "am_folgetag": 1}
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

def test_ac13_queries_load_on_sm_nachbereitung_cd_only():
    assert set(AC13) == EXPECTED
    for q in AC13.values():
        assert q.model == "nachbereitung_cd" and q.tenant == "CARGOCONTROL", q.qid


def test_dataset_is_cargocontrol_qa_only_until_the_prod_model_exists():
    assert D.lookup("nachbereitung_cd", "CARGOCONTROL", "QA").dataset_id == "d94ec3d0-7cf0-4683-9057-d95763cafe78"
    assert D.lookup("nachbereitung_cd", "CARGOCONTROL", "QA").workspace_id == D.WS_CC_QA
    with pytest.raises(D.UnknownDataset):
        D.lookup("nachbereitung_cd", "CARGOCONTROL", "PROD")
    assert D.tenants_for("nachbereitung_cd") == ("CARGOCONTROL",)


def test_every_ac13_dax_has_a_roles_file_a_view_and_what_it_replaces():
    for p in AC13_DIR.rglob("*.dax"):
        assert p.with_suffix(".roles.json").exists(), p.name
    for q in AC13.values():
        assert q.meta.get("view") and q.meta.get("grain") and q.meta.get("replaces"), q.qid


# --------------------------------------------------------------------------- minimisation (handover IRON RULE test)

# absence reasons, free-text absence names, catalogue subtype names, names and personnel numbers
_FORBIDDEN_DAX = re.compile(
    r"absence_name|absence_type|absence_reason|dim_absence|fact_absence\b|fact_absence\[|subtype|abwesenheitsgrund"
    r"|\bgrund\b|description|beschreibung|personalnummer|personnelnumber|person_sk|person_nk|dim_person\b"
    r"|firstname|lastname|vorname|nachname|\[name\]|worker_name|person_name", re.IGNORECASE)
_PSEUDONYM_COL = re.compile(r"(\w+)\s*\[\s*pseudonym\s*\]")


def test_no_ac13_query_reads_an_absence_reason_a_name_or_a_personnel_number():
    hits = []
    for p in sorted(AC13_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        hits += [f"{p.name}: {m.group(0)}" for m in _FORBIDDEN_DAX.finditer(text)]
        hits += [str(v) for v in forbidden.check_text("ac13", text, p.name)]
    assert hits == []


def test_the_pseudonym_label_comes_from_its_own_dimension_only():
    for p in sorted(AC13_DIR.rglob("*.dax")):
        for m in _PSEUDONYM_COL.finditer(p.read_text(encoding="utf-8")):
            assert m.group(1) == "dim_pseudonym_nachbereitung_cd", (p.name, m.group(0))


def test_absence_accounts_are_catalogue_names_only():
    """konto_name is read only from dim_konto (catalogue, D2-gated in Gold), never from the fact."""
    for p in sorted(AC13_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        assert "fact_abwesenheit_cd[konto_name]" not in text, p.name


def test_person_columns_are_masked_wherever_they_are_returned():
    for q in AC13.values():
        for c in ("person", "kennung"):
            if c in q.roles:
                assert q.roles[c] == "label_person", (q.qid, c)
                assert q.person_keys == ("person",), q.qid
        for c in ("tourennummer", "partner_tourennummer"):
            if c in q.roles:
                assert q.roles[c] == "label_freetext", (q.qid, c)
        assert not (set(q.roles) - {"person", "kennung"}) & PERSON_COLUMNS, q.qid
        for c in set(q.roles) & FREETEXT_COLUMNS:
            assert q.roles[c] == "label_freetext", (q.qid, c)
        assert not [c for c in q.roles if c.endswith("_sk")], q.qid          # keys leave only as person / tour


def test_only_the_drill_queries_return_a_person():
    returning = sorted(q.qid for q in AC13.values() if "person" in q.roles)
    assert returning == ["menge_grid", "person_touren", "tag_touren", "tour", "ue_touren"]


def test_unstaffed_tours_never_get_a_pseudonym():
    for qid in ("tag_touren", "tour"):
        body = AC13[qid].body
        assert "IF ( fact_tour_cd[ist_offen], BLANK (), fact_tour_cd[pseudonym_nachbereitung_cd_sk] )" in body, qid
    assert '<> "(unbesetzt)"' in AC13["menge_grid"].body
    assert "ist_offen] = FALSE ()" in AC13["person_touren"].body


# --------------------------------------------------------------------------- Q1 ruling (a), 2026-10-21

def test_no_day_grain_query_returns_uebrige_or_ohne_eintrag_on_its_own():
    for q in AC13.values():
        if "datum" not in q.roles:
            continue
        assert not {"uebrige", "ohne_eintrag"} & set(q.roles), q.qid
    st = AC13["standort_tage"]
    assert "uebrige_oder_ohne" in st.roles
    assert '"@rest", [Abwesenheitstage übrige] + [Tage ohne Eintrag]' in st.body


def test_the_calendar_paints_tours_and_family_absences_only():
    body = AC13["menge_grid"].body
    assert "[Abwesenheitstage übrige]" not in body and "[Tage ohne Eintrag]" not in body
    assert "ist_buendel" not in body and "fact_ohne_eintrag_cd" not in body
    assert 'konto_typ] = "Ruhetag"' in body and 'konto_typ] = "Urlaub"' in body


# --------------------------------------------------------------------------- rulings in the DAX

def test_month_default_is_the_models_vormonat():
    for q in AC13.values():
        if "month" in q.params:
            assert 'dim_tag_nachbereitung_cd[zeitraum] = "Vormonat"' in q.body, q.qid
            assert q.params["month"].default is None, q.qid       # never the backend clock


def test_thresholds_and_rules_come_from_the_model():
    box = AC13["az_box"].body
    assert "fact_tour_cd[schwellwert_12h]" in box and "fact_tour_cd[schwellwert_14h]" in box
    assert "820" not in box                                       # the 820 fit is a footnote, never a rule
    stand = AC13["stand"].body
    for m in ("[Regel Arbeitszeit]", "[Regel Verkauf]", "[Regel Schulung]", "[Regel Übernachtung]", "[Regel ohne Eintrag]"):
        assert m in stand, m


def test_haupttyp_never_filters_absences():
    for qid in ("monate", "standort_tage", "menge_grid"):
        body = AC13[qid].body
        assert "FILTER ( ALL ( fact_tour_cd[personaltyp_haupttyp] )" in body, qid
        assert "fact_abwesenheit_cd[personaltyp" not in body, qid


# --------------------------------------------------------------------------- masking end to end

def test_grid_masks_key_and_gold_label():
    c, _ = client_for((200, ok_body([grid_row(), grid_row(datum="2026-09-04T00:00:00", touren=0, ruhe=1)])))
    r = c.get("/api/ac13/q/menge_grid?env=QA")
    assert r.status_code == 200, r.text
    body = r.json()
    no_secret(body)
    rows = body["rows"]
    assert PSEUDONYM_RE.match(rows[0]["person"]) and rows[0]["kennung"] == rows[0]["person"] == rows[1]["person"]
    assert body["mode"] == "masked" and body["person_keys"] == ["person"]


def test_ue_touren_masks_person_and_both_tour_numbers():
    c, _ = client_for((200, ok_body([ue_row()])))
    body = c.get("/api/ac13/q/ue_touren?env=QA&month=2026-09").json()
    no_secret(body)
    row = body["rows"][0]
    assert TEXT_TOKEN_RE.match(row["tourennummer"]) and TEXT_TOKEN_RE.match(row["partner_tourennummer"])
    assert row["tourennummer"] != row["partner_tourennummer"]
    assert row["start"] == "KKAN" and row["rolle"] == "Hinweg"


def test_real_mode_shows_only_the_gold_pseudonym_and_keeps_the_key_masked():
    c, _ = client_for((200, ok_body([grid_row()])), masker=Masker(real=True))
    row = c.get("/api/ac13/q/menge_grid?env=QA").json()["rows"][0]
    assert row["kennung"] == KENNUNG and PSEUDONYM_RE.match(row["person"])


def test_undeclared_column_is_refused_with_502():
    row = grid_row()
    row["[absence_name]"] = "Erfunden"
    c, _ = client_for((200, ok_body([row])))
    r = c.get("/api/ac13/q/menge_grid?env=QA")
    assert r.status_code == 502 and "Erfunden" not in r.text


# --------------------------------------------------------------------------- params

def test_prod_is_refused_before_any_call_while_the_model_is_qa_only():
    """core-requests-ac13.md #1 (folded 2026-10-22): an env without a dataset answers 400, and nothing reaches Fabric.
    The page offers QA only until PROD is registered."""
    up = Upstream((200, ok_body([])))
    app, _ = make_app(up)
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/ac13/q/stand?env=PROD")
        assert r.status_code == 400 and "no dataset registered" in r.json()["error"]
    assert up.requests == []


@pytest.mark.parametrize("url", [
    "/api/ac13/q/stand?env=DEV",
    "/api/ac13/q/stand?env=QA&tenant=RTS",                          # CargoControl only
    "/api/ac13/q/monate?env=QA&standort=CD%20-%20K%C3%B6ln",        # a name, not a rank
    "/api/ac13/q/monate?env=QA&standort=0",
    "/api/ac13/q/monate?env=QA&standort=101",
    "/api/ac13/q/monate?env=QA&haupttyp=51",
    "/api/ac13/q/monate?env=QA&month=2026-09",                      # monate shows every month
    "/api/ac13/q/menge_grid?env=QA&month=2026-9",
    "/api/ac13/q/menge_grid?env=QA&month=Vormonat",
    "/api/ac13/q/menge_grid?env=QA&person=P-abcdef",                # the grid takes no person filter
    "/api/ac13/q/menge_grid?env=QA&konto=3",                        # no absence-account filter anywhere
    "/api/ac13/q/tag_touren?env=QA",                                # datum required
    "/api/ac13/q/tag_touren?env=QA&datum=03.09.2026",
    "/api/ac13/q/person_touren?env=QA&month=2026-09",               # person required
    "/api/ac13/q/person_touren?env=QA&person=MA-1A2B3C4D",          # only P- pseudonyms
    "/api/ac13/q/person_touren?env=QA&person=P-000000",             # unknown pseudonym
    "/api/ac13/q/tour?env=QA",                                      # tour required
    "/api/ac13/q/tour?env=QA&tour=x'y",                             # sk pattern
    "/api/ac13/q/regeln?env=QA&month=2026-09",
])
def test_param_whitelist(url):
    c, up = client_for((200, ok_body([])))
    assert c.get(url).status_code == 400
    assert up.requests == []                                       # refused before any call to Fabric


def test_unfiltered_request_sends_blanks():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac13/q/standort_tage?env=QA").status_code == 200
    sent = up.sent_query()
    for var in ("_m", "_s", "_h"):
        assert f"VAR {var} = BLANK ()" in sent, var
    assert str(up.requests[0].url) == D.lookup("nachbereitung_cd", "CARGOCONTROL", "QA").url


def test_month_and_rank_params_render_server_side():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac13/q/az_box?env=QA&month=2026-10&standort=4&haupttyp=2").status_code == 200
    sent = up.sent_query()
    assert "VAR _m = DATE ( 2026, 10, 1 )" in sent and "VAR _s = 4" in sent and "VAR _h = 2" in sent


def test_person_param_resolves_to_the_hidden_key_server_side():
    c, up = client_for((200, ok_body([grid_row()])), (200, ok_body([])))
    p = c.get("/api/ac13/q/menge_grid?env=QA").json()["rows"][0]["person"]
    assert c.get(f"/api/ac13/q/person_touren?env=QA&month=2026-09&person={p}").status_code == 200
    sent = up.sent_query()
    assert f"TREATAS ( {{ \"{PERSON_SK}\" }}, 'fact_tour_cd'[pseudonym_nachbereitung_cd_sk] )" in sent


def test_tour_param_is_a_treatas_on_the_tour_key():
    c, up = client_for((200, ok_body([])))
    assert c.get(f"/api/ac13/q/tour?env=QA&tour={TOUR_SK}").status_code == 200
    assert f'VAR _t = "{TOUR_SK}"' in up.sent_query()
    assert "TREATAS ( { _t }, fact_tour_cd[tour_cd_sk] )" in up.sent_query()


def test_ping():
    c, _ = client_for((200, ok_body([])))
    assert c.get("/api/ac13/ping").json() == {"showcase": "ac13", "ok": True}
