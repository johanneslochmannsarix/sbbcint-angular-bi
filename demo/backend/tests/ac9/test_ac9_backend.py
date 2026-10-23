"""AC-9 offline tests: query definitions on sm_rechnungslegung_rts, roles and minimisation (no name, no personnel
number, no flat Excel table; order names and Tournummern masked as free text, person_sk only as a pseudonym), the
billing rules in the DAX (IST only, netto = ohne Pause, quote per plan month), the router's server-side
resolution (order token -> ordinal, tour pseudo-id -> doi_id, person pseudonym -> person_sk), param whitelist,
role coverage and masking end to end. No Fabric, no az. Every order name, tour name, id and key below is an
invented fixture."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import datasets as D
from app.core import forbidden
from app.core import queries as Q
from app.core.masking import FREETEXT_COLUMNS, PERSON_COLUMNS, PSEUDONYM_RE, TEXT_TOKEN_RE, Masker
from app.showcases.ac9.ids import TOUR_ID_RE, TourIds
from tests.support import Upstream, make_app, ok_body

AC9_DIR = Q.QUERIES_DIR / "ac9"
AC9 = Q.load_queries()["ac9"]

ORDER_A = "AÜ Erfundenhausen Hans Muster 2026"          # an ad-hoc order name carrying a person name (R-ORD)
ORDER_B = "RT&S DL Fiktiv Basel Sep/26"
TOUR_NAME = "D4-RT&S-ÜWHZ-ZZ Erika Beispiel"
DOI_1 = "0a1b2c3d-1111-2222-3333-444455556666"
DOI_2 = "9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff"
PERSON_SK = "c" * 64
SECRETS = [ORDER_A, ORDER_B, "Hans", "Muster", "Erika", "Beispiel", TOUR_NAME, DOI_1, DOI_2, PERSON_SK]

EXPECTED = {"stand", "monate", "kpi", "quote", "auftrag_liste", "auftraege", "punkte", "auftrag_tage", "touren",
            "tour_kopf", "tour", "person"}


def _dax_row(d: dict) -> dict:
    return {f"[{k}]": v for k, v in d.items()}


def liste_rows() -> list[dict]:
    base = {"geschaeftsart": "AÜ", "kategorie_auftrag": None, "erster_monat": "2026-01", "letzter_monat": "2026-09",
            "touren": 120, "touren_ist": 80, "netto_h": 800.5}
    return [_dax_row({"dor_name": ORDER_A, "nr": 1, **base}),
            _dax_row({"dor_name": ORDER_B, "nr": 2, **base, "geschaeftsart": "DL", "kategorie_auftrag": "Langläufer Köln-Basel"})]


def monate_row(**kw) -> dict:
    r = {"year_month_ist": "2026-09", "geschaeftsart": None, "ga_total": True, "touren": 10, "brutto_h": 100.0,
         "netto_h": 96.0, "pause_h": 4.0, "azu_h": 10.0, "fahrt_h": 12.0, "avg_h": 10.0, "ue10": 5, "ue12": 2, "ue14": 1,
         "abweichungen": 0, "touren_int": 0, "touren_sbbcd": 0, "auftrag_echo": None}
    r.update(kw)
    return _dax_row(r)


def punkt_row(doi: str = DOI_1, **kw) -> dict:
    r = {"doi_id": doi, "dor_name": ORDER_A, "geschaeftsart": "AÜ", "kategorie_auftrag": None,
         "year_month_ist": "2026-09", "ist_start": "2026-09-10T06:00:00", "ist_dauer_h": 12.5, "netto_h": 12.0,
         "plan_dauer_h": 9.0, "gap_h": 3.5}
    r.update(kw)
    return _dax_row(r)


def kopf_row(**kw) -> dict:
    r = {"doi_id": DOI_1, "dor_name": ORDER_A, "tourbezeichnung": TOUR_NAME, "geschaeftsart": "AÜ",
         "kategorie_auftrag": None, "preiskategorie": None, "year_month_ist": "2026-09", "plan_monat": "2026-09",
         "plan_start": "2026-09-10T05:00:00", "plan_ende": "2026-09-10T14:00:00", "plan_dauer_h": 9.0,
         "ist_start": "2026-09-10T06:00:00", "ist_ende": "2026-09-10T18:30:00", "ist_dauer_h": 12.5, "netto_h": 12.0,
         "pause_h": 0.5, "azu_h": 1.0, "fahrt_h": 2.0, "ist_vollstaendig": True, "tour_abgeschlossen": True,
         "n_elemente": 4, "n_elemente_ist": 4}
    r.update(kw)
    return _dax_row(r)


def element_row(**kw) -> dict:
    r = {"person_sk": PERSON_SK, "zeitart": "Arbeit", "taetigkeit": "Einsatz", "ist_start": "2026-09-10T06:00:00",
         "ist_ende": "2026-09-10T10:00:00", "ist_dauer_h": 4.0, "ist_vollstaendig": True, "year_month": "2026-09",
         "plan_start": "2026-09-10T05:00:00", "plan_ende": "2026-09-10T14:00:00"}
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


def no_secret(payload) -> None:
    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    for s in SECRETS:
        assert s not in text, s


def token_of(c: TestClient, env: str, raw_name: str) -> str:
    """The token the order list gave raw_name (looked up by position: fixtures are in nr order)."""
    rows = c.get(f"/api/ac9/q/auftrag_liste?env={env}").json()["rows"]
    return rows[[ORDER_A, ORDER_B].index(raw_name)]["auftrag_token"]


# --------------------------------------------------------------------------- definitions

def test_ac9_queries_load_on_the_billing_model_only():
    assert set(AC9) == EXPECTED
    for q in AC9.values():
        assert q.model == "rechnungslegung" and q.tenant == "RTS", q.qid


def test_rechnungslegung_dataset_ids():
    assert D.lookup("rechnungslegung", "RTS", "PROD").dataset_id == "0789cd46-64c1-4b0f-b25a-383df1af6a24"
    assert D.lookup("rechnungslegung", "RTS", "PROD").workspace_id == D.WS_RTS_PROD
    assert D.lookup("rechnungslegung", "RTS", "QA").dataset_id == "df0ce5da-42fb-476a-a697-0316a38d7bba"
    assert D.lookup("rechnungslegung", "RTS", "QA").workspace_id == D.WS_RTS_QA
    with pytest.raises(D.UnknownDataset):
        D.lookup("rechnungslegung", "CARGOCONTROL", "PROD")


def test_every_ac9_query_documents_view_grain_and_what_it_replaces():
    for p in AC9_DIR.rglob("*.dax"):
        assert p.with_suffix(".roles.json").exists(), p.name
    for q in AC9.values():
        assert q.meta.get("view") and q.meta.get("grain") and q.meta.get("replaces"), q.qid


_MEASURE_RE = re.compile(r"\[([^\]\[]+)\]")
_MIRROR = Path(__file__).resolve().parents[6] / "rts-prod" / "sm_rechnungslegung_rts.SemanticModel" / "definition" / "tables"


@pytest.mark.skipif(not _MIRROR.exists(), reason="PROD mirror of sm_rechnungslegung_rts not present")
def test_every_measure_called_exists_in_the_model():
    """A bracket reference that is not a column of the two facts / dim_date and not a query-local name must be a
    _Kennzahlen measure of the PROD mirror (one home for the numbers)."""
    tmdl = (_MIRROR / "_Kennzahlen.tmdl").read_text(encoding="utf-8")
    measures = {a or b for a, b in re.findall(r"^\tmeasure (?:'([^']+)'|([^\s=']+))", tmdl, re.M)}
    columns = set()
    for t in ("fact_tour_abrechnung", "fact_person_tour_ist", "dim_date"):
        columns |= set(re.findall(r"^\tcolumn (\w+)", (_MIRROR / f"{t}.tmdl").read_text(encoding="utf-8"), re.M))
    for q in AC9.values():
        local = set(re.findall(r'"(@?\w+)"', q.body)) | set(q.columns)
        for ref in _MEASURE_RE.findall(q.body):
            if ref in columns or ref in local:
                continue
            assert ref in measures, (q.qid, ref)


# --------------------------------------------------------------------------- minimisation and rules

_FORBIDDEN_REFS = re.compile(
    r"fact_abrechnung_flach|dim_person|person_name|personnelnumber|Personalnummer|Mitarbeitende|dor_creator"
    r"|dor_ordernumber|start_location|end_location|worker_type_name|tenant_sk|loclocation", re.IGNORECASE)


def test_no_ac9_query_reads_names_numbers_or_the_flat_excel_table():
    hits = []
    for p in sorted(AC9_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        hits += [f"{p.name}: {m.group(0)}" for m in _FORBIDDEN_REFS.finditer(text)]
        hits += [str(v) for v in forbidden.check_text("ac9", text, p.name)]
    assert hits == []


def test_order_and_tour_names_are_free_text_wherever_returned():
    for q in AC9.values():
        for col in ("dor_name", "tourbezeichnung", "auftrag_echo"):
            if col in q.roles:
                assert q.roles[col] == "label_freetext", (q.qid, col)
        for c in set(q.roles) & FREETEXT_COLUMNS:
            assert q.roles[c] == "label_freetext", (q.qid, c)


def test_person_sk_only_as_a_pseudonym_and_only_in_the_tour_elements():
    with_person = [q.qid for q in AC9.values() if set(q.roles) & PERSON_COLUMNS]
    assert with_person == ["tour"]
    assert AC9["tour"].person_keys == ("person_sk",) and AC9["tour"].roles["person_sk"] == "label_person"
    assert AC9["person"].params["person"].type == "pseudonym" and not AC9["person"].person_keys


def test_doi_id_never_returned_without_the_pseudo_id_transform():
    from app.showcases.ac9.router import TOUR_ID_QUERIES
    returning = {q.qid for q in AC9.values() if "doi_id" in q.columns}
    assert returning == set(TOUR_ID_QUERIES)
    for qid in returning:
        assert AC9[qid].derived == {"tour": "id"}, qid


def test_ordinal_never_returned_without_the_capture_transform():
    from app.showcases.ac9.router import ORDER_CAPTURE_QUERIES
    assert {q.qid for q in AC9.values() if "nr" in q.columns} == set(ORDER_CAPTURE_QUERIES)
    for qid in ORDER_CAPTURE_QUERIES:
        assert AC9[qid].derived == {"auftrag_token": "id"}, qid


def test_billing_figures_are_ist_measures_and_plan_is_never_summed():
    """R-IST: hours come from the IST measures / columns; plan duration appears only per tour (context)."""
    for q in AC9.values():
        assert not re.search(r"SUM\w*\s*\([^)]*plan_dauer", q.body), q.qid
        assert "[Summe Stunden" not in q.body, q.qid                # the flat table's measures stay unused
    assert "[IST-Stunden ohne Pause]" in AC9["kpi"].body and "[IST-Stunden brutto]" in AC9["kpi"].body


def test_rueckmeldequote_is_per_planned_month_and_tour_grain():
    """R-RQ / D6: the quote axis is plan_monat; the quote measures read fact_tour_abrechnung only."""
    assert "fact_tour_abrechnung[plan_monat]," in AC9["quote"].body
    assert "year_month_ist" not in AC9["quote"].body
    kpi = AC9["kpi"].body
    for line in [ln for ln in kpi.splitlines() if "quote" in ln and "CALCULATE" in ln]:
        assert "REMOVEFILTERS ( fact_tour_abrechnung[year_month_ist] )" in line and "_fPlanMonat" in line, line
    for q in AC9.values():
        assert not re.search(r"Quote[^\n]*fact_person_tour_ist", q.body), q.qid


def test_no_nl_marker_and_no_mindestabnahme():
    for q in AC9.values():
        assert '"NL"' not in q.body and "Mindest" not in q.body, q.qid
    assert "NL" not in AC9["monate"].params["kat"].values


# --------------------------------------------------------------------------- order token resolution

def test_order_list_masks_names_and_drops_the_ordinal():
    c, _ = client_for((200, ok_body(liste_rows())))
    body = c.get("/api/ac9/q/auftrag_liste?env=PROD").json()
    no_secret(body)
    assert "nr" not in body["columns"] and all("nr" not in r for r in body["rows"])
    assert all(TEXT_TOKEN_RE.match(r["dor_name"]) for r in body["rows"])
    assert all(r["auftrag_token"] == r["dor_name"] for r in body["rows"])           # masked: the token both ways
    assert body["roles"]["auftrag_token"] == "id"


def test_order_token_resolves_to_the_ordinal_server_side():
    c, up = client_for((200, ok_body(liste_rows())), (200, ok_body([])))
    tok_b = token_of(c, "PROD", ORDER_B)
    r = c.get(f"/api/ac9/q/monate?env=PROD&auftrag={tok_b}")
    assert r.status_code == 200, r.text
    sent = up.sent_query()
    assert "VAR _nr = 2" in sent
    no_secret(sent)                                                   # the name never reaches the DAX text
    assert len(up.requests) == 2


def test_order_token_triggers_the_order_list_on_a_cold_map():
    c, up = client_for((200, ok_body(liste_rows())), (200, ok_body([])))
    masker = c.app.state.core.masker
    tok_a = masker.text_token(ORDER_A)                                 # the token another showcase would show
    r = c.get(f"/api/ac9/q/kpi?env=PROD&auftrag={tok_a}&von=2026-09&bis=2026-09")
    assert r.status_code == 200, r.text
    assert "VAR _nr = 1" in up.sent_query() and "VAR _von = DATE ( 2026, 9, 1 )" in up.sent_query()
    assert len(up.requests) == 2                                       # auftrag_liste once, then kpi


def test_order_tokens_are_per_env():
    c, up = client_for((200, ok_body(liste_rows())), (200, ok_body(liste_rows())), (200, ok_body([])))
    tok = token_of(c, "PROD", ORDER_A)
    r = c.get(f"/api/ac9/q/monate?env=QA&auftrag={tok}")             # QA list not loaded: fetched, then found
    assert r.status_code == 200, r.text
    qa = D.lookup("rechnungslegung", "RTS", "QA").url
    assert [str(q.url) == qa for q in up.requests] == [False, True, True]
    assert r.json()["params"]["auftrag"] == tok                       # the echo is the token, not the ordinal


def test_resolved_keys_never_echo_back():
    c, _ = client_for((200, ok_body([punkt_row()])), (200, ok_body([kopf_row()])))
    pid = c.get("/api/ac9/q/punkte?env=PROD").json()["rows"][0]["tour"]
    body = c.get(f"/api/ac9/q/tour_kopf?env=PROD&tour={pid}").json()
    assert body["params"] == {"tour": pid}
    no_secret(body)
    again = c.get(f"/api/ac9/q/tour_kopf?env=PROD&tour={pid}").json()   # from the cache: same echo
    assert again["cached"] and again["params"] == {"tour": pid}


def test_echo_is_masked_like_the_order_name():
    c, _ = client_for((200, ok_body(liste_rows())), (200, ok_body([monate_row(auftrag_echo=ORDER_A)])))
    tok = token_of(c, "PROD", ORDER_A)
    body = c.get(f"/api/ac9/q/monate?env=PROD&auftrag={tok}").json()
    no_secret(body)
    assert body["rows"][0]["auftrag_echo"] == tok


@pytest.mark.parametrize("value", ["2", "T-000000", ORDER_A, "T-zzzzzz", "x" * 300])
def test_raw_ordinals_names_and_unknown_tokens_are_refused(value):
    c, up = client_for((200, ok_body(liste_rows())))
    r = c.get("/api/ac9/q/monate", params={"env": "PROD", "auftrag": value})
    assert r.status_code == 400
    no_secret(r.text)
    assert len(up.requests) <= 1                                        # at most the order list, never monate
    for q in up.requests:
        assert "ALL ( fact_tour_abrechnung[dor_name] )" in json.loads(q.content)["queries"][0]["query"]


def test_real_mode_shows_names_but_filters_by_token_and_sends_only_the_ordinal():
    c, up = client_for((200, ok_body(liste_rows())), (200, ok_body([])), masker=Masker(real=True))
    rows = c.get("/api/ac9/q/auftrag_liste?env=PROD").json()["rows"]
    assert [r["dor_name"] for r in rows] == [ORDER_A, ORDER_B]
    assert all(TEXT_TOKEN_RE.match(r["auftrag_token"]) for r in rows)
    assert c.get("/api/ac9/q/monate", params={"env": "PROD", "auftrag": ORDER_A}).status_code == 400   # never a name
    r = c.get("/api/ac9/q/monate", params={"env": "PROD", "auftrag": rows[0]["auftrag_token"]})
    assert r.status_code == 200, r.text
    assert "VAR _nr = 1" in up.sent_query() and ORDER_A not in up.sent_query()


# --------------------------------------------------------------------------- tour pseudo-id

def test_points_carry_pseudo_ids_not_doi_ids():
    c, _ = client_for((200, ok_body([punkt_row(DOI_1), punkt_row(DOI_2, geschaeftsart="DL")])))
    body = c.get("/api/ac9/q/punkte?env=PROD&von=2026-09&bis=2026-09").json()
    no_secret(body)
    assert "doi_id" not in body["columns"] and "tour" in body["columns"]
    ids = [r["tour"] for r in body["rows"]]
    assert all(TOUR_ID_RE.match(t) for t in ids) and ids[0] != ids[1]
    assert body["roles"]["tour"] == "id" and all(TEXT_TOKEN_RE.match(r["dor_name"]) for r in body["rows"])


def test_tour_pseudo_id_resolves_to_a_treatas_on_doi_id():
    c, up = client_for((200, ok_body([punkt_row(DOI_1)])), (200, ok_body([kopf_row()])), (200, ok_body([element_row()])))
    pid = c.get("/api/ac9/q/punkte?env=PROD").json()["rows"][0]["tour"]
    hd = c.get(f"/api/ac9/q/tour_kopf?env=PROD&tour={pid}")
    assert hd.status_code == 200, hd.text
    assert f"TREATAS ( {{ \"{DOI_1}\" }}, 'fact_tour_abrechnung'[doi_id] )" in up.sent_query()
    no_secret(hd.json())
    assert hd.json()["rows"][0]["tour"] == pid
    el = c.get(f"/api/ac9/q/tour?env=PROD&tour={pid}")
    assert el.status_code == 200
    assert f"TREATAS ( {{ \"{DOI_1}\" }}, 'fact_person_tour_ist'[doi_id] )" in up.sent_query()


@pytest.mark.parametrize("value", [DOI_1, "D-0000000000", "D-12345", "P-abcdef"])
def test_raw_or_unknown_tour_ids_are_refused(value):
    c, up = client_for((200, ok_body([])))
    r = c.get("/api/ac9/q/tour_kopf", params={"env": "PROD", "tour": value})
    assert r.status_code == 400 and up.requests == []


def test_tour_ids_are_per_process_and_stable():
    a, b = TourIds(), TourIds()
    assert a.pid(DOI_1) == a.pid(DOI_1) and a.pid(DOI_1) != b.pid(DOI_1)
    assert a.resolve(a.pid(DOI_1)) == DOI_1 and b.resolve(a.pid(DOI_1)) is None


# --------------------------------------------------------------------------- person pseudonym

def test_tour_elements_show_the_pseudonym_and_the_person_query_resolves_it():
    c, up = client_for((200, ok_body([punkt_row()])), (200, ok_body([element_row(), element_row(zeitart="Pause")])),
                       (200, ok_body([])))
    pid = c.get("/api/ac9/q/punkte?env=PROD").json()["rows"][0]["tour"]
    el = c.get(f"/api/ac9/q/tour?env=PROD&tour={pid}").json()
    no_secret(el)
    p = el["rows"][0]["person_sk"]
    assert PSEUDONYM_RE.match(p) and el["person_keys"] == ["person_sk"] and el["rows"][1]["person_sk"] == p
    r = c.get(f"/api/ac9/q/person?env=PROD&person={p}")
    assert r.status_code == 200, r.text
    assert f"TREATAS ( {{ \"{PERSON_SK}\" }}, 'fact_person_tour_ist'[person_sk] )" in up.sent_query()


def test_unknown_pseudonym_is_refused():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac9/q/person?env=PROD&person=P-abcdef").status_code == 400
    assert up.requests == []


def test_same_pseudonym_as_the_core_masker_gives_other_showcases():
    """AC-7 / AC-2 / AC-1 link by the same (tenant RTS, person_sk) pseudonym within one backend process."""
    c, _ = client_for((200, ok_body([punkt_row()])), (200, ok_body([element_row()])))
    pid = c.get("/api/ac9/q/punkte?env=PROD").json()["rows"][0]["tour"]
    p = c.get(f"/api/ac9/q/tour?env=PROD&tour={pid}").json()["rows"][0]["person_sk"]
    assert c.app.state.core.masker.pseudonym(PERSON_SK, "RTS") == p


# --------------------------------------------------------------------------- params, rendering, coverage

@pytest.mark.parametrize("url", [
    "/api/ac9/q/kpi?env=PROD&ga=A%C3%9C",                    # the core enum refuses «Ü»: AUE
    "/api/ac9/q/kpi?env=PROD&ga=aue",                         # enum is exact
    "/api/ac9/q/kpi?env=PROD&kat=NL",                         # no NL marker exists (R-KAT)
    "/api/ac9/q/kpi?env=PROD&von=2026-13",
    "/api/ac9/q/kpi?env=PROD&von=2026-09&bis=2026-01",        # von after bis
    "/api/ac9/q/monate?env=PROD&von=2026-09",                 # monate is over all months
    "/api/ac9/q/quote?env=PROD&von=2026-09",                  # the quote axis is all plan months
    "/api/ac9/q/touren?env=PROD&von=2026-09",                 # auftrag required
    "/api/ac9/q/auftrag_tage?env=PROD",                       # auftrag required
    "/api/ac9/q/tour?env=PROD",                               # tour required
    "/api/ac9/q/person?env=PROD",                             # person required
    "/api/ac9/q/stand?env=DEV",
    "/api/ac9/q/stand?env=PROD&tenant=CARGOCONTROL",          # RT&S only
    "/api/ac9/q/stand?env=PROD&monat=2026-09",                # not whitelisted
    "/api/ac9/q/nope?env=PROD",
])
def test_param_whitelist(url):
    c, up = client_for((200, ok_body([])))
    assert c.get(url).status_code in (400, 404)
    assert up.requests == []


def test_unfiltered_request_sends_blanks_and_the_mapping_stays_in_the_dax():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac9/q/kpi?env=PROD").status_code == 200
    sent = up.sent_query()
    for var in ("_von", "_bis", "_ga", "_kat", "_nr"):
        assert f"VAR {var} = BLANK ()" in sent, var
    assert 'SWITCH ( _ga, "AUE", "AÜ", "DL", "DL" )' in sent


def test_filters_render_as_literals():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac9/q/punkte?env=QA&von=2026-06&bis=2026-08&ga=DL&kat=int").status_code == 200
    sent = up.sent_query()
    assert "VAR _von = DATE ( 2026, 6, 1 )" in sent and "VAR _bis = DATE ( 2026, 8, 1 )" in sent
    assert 'VAR _ga = "DL"' in sent and 'VAR _kat = "int"' in sent
    assert str(up.requests[0].url) == D.lookup("rechnungslegung", "RTS", "QA").url


def test_undeclared_column_is_refused_with_502_and_leaks_nothing():
    row = kopf_row()
    row["[Personalnummer]"] = "123456"
    c, _ = client_for((200, ok_body([punkt_row()])), (200, ok_body([row])))
    pid = c.get("/api/ac9/q/punkte?env=PROD").json()["rows"][0]["tour"]
    r = c.get(f"/api/ac9/q/tour_kopf?env=PROD&tour={pid}")
    assert r.status_code == 502
    assert "123456" not in r.text
    no_secret(r.text)


def test_missing_declared_column_is_refused_with_502():
    row = monate_row()
    del row["[ue14]"]
    c, _ = client_for((200, ok_body([row])))
    assert c.get("/api/ac9/q/monate?env=PROD").status_code == 502


def test_real_mode_shows_the_names_but_the_person_key_stays_a_pseudonym():
    c, _ = client_for((200, ok_body([punkt_row()])), (200, ok_body([kopf_row()])), (200, ok_body([element_row()])),
                      masker=Masker(real=True))
    pid = c.get("/api/ac9/q/punkte?env=PROD").json()["rows"][0]["tour"]
    hd = c.get(f"/api/ac9/q/tour_kopf?env=PROD&tour={pid}").json()["rows"][0]
    assert hd["dor_name"] == ORDER_A and hd["tourbezeichnung"] == TOUR_NAME
    el = c.get(f"/api/ac9/q/tour?env=PROD&tour={pid}").json()["rows"][0]
    assert PSEUDONYM_RE.match(el["person_sk"])


def test_queries_listing_names_the_resolved_params():
    c, _ = client_for((200, ok_body([])))
    qs = {q["name"]: q for q in c.get("/api/ac9/queries").json()["queries"]}
    assert set(qs) == EXPECTED
    p = {x["name"]: x for x in qs["monate"]["params"]}
    assert p["auftrag"]["type"] == "order_token"
    assert {x["name"]: x for x in qs["tour_kopf"]["params"]}["tour"]["type"] == "tour_pseudo_id"


def test_ping():
    c, _ = client_for((200, ok_body([])))
    assert c.get("/api/ac9/ping").json() == {"showcase": "ac9", "ok": True}
