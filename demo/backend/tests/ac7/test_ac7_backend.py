"""AC-7 offline tests: query definitions, the no-birth-date and no-writable-field rulings, minimisation, role
coverage, masking end to end (persons + order names), server-side resolution of the order-name token and the person
pseudonym, the param whitelist, the coordinate route. No Fabric, no az. Every name, key, order name and place below
is an invented fixture."""
from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient

from app.core import forbidden
from app.core import queries as Q
from app.core.masking import PSEUDONYM_RE, TEXT_TOKEN_RE, Masker
from tests.support import FakeOpener, Upstream, fake_bronze, make_app, ok_body

AC7_DIR = Q.QUERIES_DIR / "ac7"
AC7 = Q.load_queries()["ac7"]
VIEWS = ("liste", "kpi", "fluss", "arbeitszeit", "orte")
FILTER_PARAMS = {"status", "ga", "taet", "ort", "auftrag_nr", "jahr", "person"}

# --------------------------------------------------------------------------- fixtures (invented)

PEOPLE = {"sk-verleih-0001": ("Erfunden", "Rita"), "sk-verleih-0002": ("Fiktiv", "Beat")}
ORDERS = ["Musterkunde_AÜ Erfunden", "Beispiel DL Fiktivbahn"]
PLACE = "Musterbahnhof Nord"
SECRETS = ["Rita", "Erfunden", "Beat", "Fiktiv", "Musterkunde", "Beispiel", *PEOPLE]


def _dax_row(d: dict) -> dict:
    return {f"[{k}]": v for k, v in d.items()}


def liste_row(sk: str, **kw) -> dict:
    nach, vor = PEOPLE[sk]
    r = {"person_sk": sk, "nachname": nach, "vorname": vor, "status_code": "AKTIV", "status": "aktiv",
         "geschaeftsart": "AÜ", "taetigkeit": "Lokführer", "arbeitszeit_monat_h": 170.0, "arbeitszeit_woche_h": None,
         "vertrag_gueltig": True, "eintritt": "2024-03-01T00:00:00", "austritt": None,
         "einsatz1_von": "2026-04-01T00:00:00", "einsatz1_bis": "2026-11-30T00:00:00", "einsatz1_ort": PLACE,
         "einsatz1_anzahl_orte": 1, "einsatz1_auftrag": ORDERS[0], "einsatz1_geschaeftsart": "AÜ",
         "einsatz2_von": "2025-09-01T00:00:00", "einsatz2_bis": "2026-03-28T00:00:00", "einsatz2_ort": PLACE,
         "einsatz2_anzahl_orte": 2, "einsatz2_auftrag": ORDERS[1], "einsatz2_geschaeftsart": "DL",
         "anzahl_verleihstationen": 3, "erster_einsatz_von": "2025-01-06T00:00:00", "letzter_einsatz_bis": "2026-11-30T00:00:00"}
    r.update(kw)
    return _dax_row(r)


def auftraege_rows() -> list[dict]:
    return [_dax_row({"rang": i + 1, "auftrag": a, "geschaeftsart": "AÜ" if "AÜ" in a else "DL",
                      "personen_einsatz1": 3, "personen_einsatz2": 1}) for i, a in enumerate(sorted(ORDERS))]


def kpi_row() -> dict:
    return _dax_row({c: 1 for c in AC7["kpi"].columns})


_OPEN: list[TestClient] = []


@pytest.fixture(autouse=True)
def _close_clients():
    yield
    while _OPEN:
        _OPEN.pop().__exit__(None, None, None)


def client_for(*answers, masker: Masker | None = None, bronze=None):
    up = Upstream(*answers)
    app, _ = make_app(up, masker=masker, bronze=bronze)
    c = TestClient(app)
    c.__enter__()
    _OPEN.append(c)
    return c, up


def no_secret(payload) -> None:
    text = json.dumps(payload, ensure_ascii=False)
    for s in SECRETS:
        assert s not in text, s


# --------------------------------------------------------------------------- definitions

def test_ac7_queries_load_on_the_verleihliste_model_rts_only():
    assert set(AC7) == {"stand", "liste", "kpi", "fluss", "arbeitszeit", "orte", "taetigkeiten", "auftraege"}
    for q in AC7.values():
        assert q.tenant == "RTS", q.qid                          # RT&S only, never CC (SAX-30)
        assert q.model == ("import" if q.qid == "stand" else "au_verleihliste"), q.qid


def test_every_ac7_dax_has_a_roles_file_a_view_and_a_grain():
    for p in AC7_DIR.rglob("*.dax"):
        assert p.with_suffix(".roles.json").exists(), p.name
    for q in AC7.values():
        assert q.meta.get("view") and q.meta.get("grain") and q.meta.get("replaces"), q.qid


def test_filtered_views_take_the_whole_filter_set():
    for v in VIEWS:
        assert set(AC7[v].params) == FILTER_PARAMS, v
    for v in ("stand", "taetigkeiten", "auftraege"):
        assert not AC7[v].params, v                              # dims stay unfiltered


def _prelude(name: str) -> str:
    text = (AC7_DIR / f"{name}.dax").read_text(encoding="utf-8")
    return text[text.index("DEFINE"):text.index("EVALUATE")]


def test_filtered_views_share_one_prelude_so_ranks_mean_the_same_everywhere():
    base = _prelude("liste")
    for v in ("kpi", "fluss", "arbeitszeit"):
        assert _prelude(v) == base, v
    assert _prelude("orte").startswith(base)                     # + its own rank column


def test_rank_sets_match_between_dims_and_filters():
    liste = (AC7_DIR / "liste.dax").read_text(encoding="utf-8")
    tae = (AC7_DIR / "taetigkeiten.dax").read_text(encoding="utf-8")
    auf = (AC7_DIR / "auftraege.dax").read_text(encoding="utf-8")
    rank = "COUNTROWS ( FILTER ( ALL ( fact_au_verleihliste[Taetigkeit] ), fact_au_verleihliste[Taetigkeit] <= v ) )"
    assert rank in liste and rank in tae
    for col in ("Einsatz 1 Auftrag", "Einsatz 2 Auftrag"):
        assert f"fact_au_verleihliste[{col}]" in liste and f"fact_au_verleihliste[{col}]" in auf


def test_person_and_freetext_columns_carry_masked_roles():
    for q in AC7.values():
        for col, role in q.roles.items():
            if col in ("person_sk", "nachname", "vorname"):
                assert role == "label_person", (q.qid, col)
            if re.fullmatch(r"(einsatz\d_)?auftrag", col):
                assert role == "label_freetext", (q.qid, col)
    assert AC7["liste"].person_keys == ("person_sk",)
    assert AC7["liste"].label_of == {"nachname": "person_sk", "vorname": "person_sk"}


def test_aggregates_return_no_person_or_freetext_column():
    for qid in ("stand", "kpi", "fluss", "arbeitszeit", "orte", "taetigkeiten"):
        assert not [c for c, r in AC7[qid].roles.items() if r in ("label_person", "label_freetext")], qid


# --------------------------------------------------------------------------- rulings as tests

_DOB_TOKEN = re.compile(r"[A-Za-zÄÖÜäöüß0-9]+")


def birth_hits(text: str) -> list[str]:
    """Birth-date-like identifiers, matched per segment (split on _ / spaces / brackets), never as a substring of
    another word: a segment that is exactly «dob», starts with «geburt», or contains «birth»."""
    hits = []
    for seg in _DOB_TOKEN.findall(text):
        s = seg.lower()
        if s == "dob" or s.startswith("geburt") or "birth" in s:
            hits.append(seg)
    return hits


# the writable free-text field under Tätigkeit (BI exclusion list, AC-7): no such column may be referenced
_WRITABLE = re.compile(r"beschreib|freitext|freetext|free_text|bemerkung|notiz|kommentar|comment|description|zusatz",
                       re.IGNORECASE)
_TAET_COL = re.compile(r"\[([^\]]*t(?:ae|ä)tigkeit[^\]]*)\]", re.IGNORECASE)


def _ac7_texts():
    for p in sorted(AC7_DIR.rglob("*")):
        if p.suffix == ".dax" or p.name.endswith(".roles.json"):
            yield p, p.read_text(encoding="utf-8")


def test_birth_hits_matches_per_segment_not_substring():
    for bad in ("geburtsdatum", "date_of_birth", "dateofbirth", "Birthday", "person_dob", "'fact'[Geburt Datum]"):
        assert birth_hits(bad), bad
    for ok in ("adobe", "dobler_ort", "einsatz1_bis", "doble", "birch"):
        assert not birth_hits(ok), ok


def test_no_ac7_query_or_roles_file_references_a_birth_date():
    hits = []
    for p, text in _ac7_texts():
        hits += [f"{p.name}: {h}" for h in birth_hits(text)]
        if p.suffix == ".dax":
            hits += [str(v) for v in forbidden.check_text("ac7", text, p.name)]
    assert hits == []


def test_no_ac7_roles_declare_a_birth_date_column():
    for q in AC7.values():
        assert not [c for c in q.roles if birth_hits(c)], q.qid


def test_core_refuses_a_birth_date_in_ac7():
    assert forbidden.check_text("ac7", "EVALUATE VALUES ( fact_au_verleihliste[Geburtsdatum] )")
    assert forbidden.check_text("ac7", 'EVALUATE ROW ( "date_of_birth", 1 )')


def test_the_writable_taetigkeit_field_is_never_referenced():
    hits = []
    for p, text in _ac7_texts():
        if p.suffix == ".dax":                     # column references and output names, comments excluded
            body = _code(text)
            names = re.findall(r"\[([^\]]+)\]", body) + re.findall(r'"([^"]+)"', body)
            cols = {m.group(1) for m in _TAET_COL.finditer(body)}
            assert cols <= {"Taetigkeit", "taetigkeit", "@taet"}, (p.name, cols)
        else:                                      # declared columns and params (role names like label_freetext are fine)
            spec = json.loads(text)
            names = [*spec.get("columns", {}), *spec.get("derived", {}), *spec.get("params", {})]
        hits += [f"{p.name}: {n}" for n in names if _WRITABLE.search(n)]
    assert hits == []


def _code(text: str) -> str:
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("--"))


def test_no_person_nk_tenant_nk_or_contract_dates_are_queried():
    for p in sorted(AC7_DIR.rglob("*.dax")):
        text = _code(p.read_text(encoding="utf-8"))
        for col in ("person_nk", "tenant_nk", "Vertrag gueltig von", "Vertrag gueltig bis", "firstname", "lastname",
                    "personnelnumber", "system_name", "environment_name", "loclocation", "_timezone"):
            assert col.lower() not in text.lower(), (p.name, col)


def test_no_cargocontrol_anywhere():
    for p, text in _ac7_texts():
        assert "CARGOCONTROL" not in text.upper(), p.name           # no CC link of any kind (SAX-30)


def test_routes_are_read_only():
    c, _ = client_for((200, ok_body([])))
    for path in ("/api/ac7/v/liste", "/api/ac7/auftraege", "/api/ac7/locations", "/api/ac7/q/kpi"):
        assert c.post(path, params={"env": "PROD"}).status_code == 405


# --------------------------------------------------------------------------- masking end to end

def test_liste_masks_names_and_order_names():
    rows = [liste_row("sk-verleih-0001"), liste_row("sk-verleih-0002", einsatz2_von=None, einsatz2_bis=None,
                                                    einsatz2_ort=None, einsatz2_auftrag=None, einsatz2_geschaeftsart=None)]
    c, _ = client_for((200, ok_body(rows)))
    r = c.get("/api/ac7/v/liste", params={"env": "PROD"})
    assert r.status_code == 200, r.text
    body = r.json()
    no_secret(body)
    a, b = body["rows"]
    assert PSEUDONYM_RE.match(a["person_sk"]) and a["nachname"] == a["person_sk"] == a["vorname"]
    assert TEXT_TOKEN_RE.match(a["einsatz1_auftrag"]) and TEXT_TOKEN_RE.match(a["einsatz2_auftrag"])
    assert b["einsatz2_auftrag"] is None                             # no stint 2 stays null, never a fake token
    assert a["einsatz1_ort"] == PLACE                                # operational site: label_location passes
    assert body["mode"] == "masked" and body["person_keys"] == ["person_sk"]


def test_real_mode_shows_names_but_keeps_the_key_a_pseudonym():
    c, _ = client_for((200, ok_body([liste_row("sk-verleih-0001")])), masker=Masker(real=True))
    row = c.get("/api/ac7/v/liste", params={"env": "PROD"}).json()["rows"][0]
    assert (row["nachname"], row["vorname"]) == PEOPLE["sk-verleih-0001"]
    assert row["einsatz1_auftrag"] == ORDERS[0]
    assert PSEUDONYM_RE.match(row["person_sk"])


def test_same_person_same_pseudonym_as_the_rts_import_model():
    m = Masker(real=False)
    c, _ = client_for((200, ok_body([liste_row("sk-verleih-0001")])), masker=m)
    p = c.get("/api/ac7/v/liste", params={"env": "PROD"}).json()["rows"][0]["person_sk"]
    assert p == m.pseudonym("sk-verleih-0001", "RTS")                # AC-2 RT&S resolves the same pseudonym


def test_undeclared_column_is_refused_with_502():
    row = liste_row("sk-verleih-0001")
    row["[geburtsdatum]"] = "1990-01-01T00:00:00"
    c, _ = client_for((200, ok_body([row])))
    r = c.get("/api/ac7/v/liste", params={"env": "PROD"})
    assert r.status_code == 502 and "1990" not in r.text


def test_missing_declared_column_is_refused_with_502():
    row = liste_row("sk-verleih-0001")
    del row["[einsatz1_ort]"]
    c, _ = client_for((200, ok_body([row])))
    assert c.get("/api/ac7/v/liste", params={"env": "PROD"}).status_code == 502


# --------------------------------------------------------------------------- order-name token

def test_auftraege_adds_the_token_in_every_mode():
    for real in (False, True):
        m = Masker(real=real)
        c, _ = client_for((200, ok_body(auftraege_rows())), masker=m)
        body = c.get("/api/ac7/auftraege", params={"env": "PROD"}).json()
        toks = {r["auftrag_token"] for r in body["rows"]}
        assert toks == {m.text_token(a) for a in ORDERS}
        assert all(TEXT_TOKEN_RE.match(t) for t in toks)
        if real:
            assert {r["auftrag"] for r in body["rows"]} == set(ORDERS)
        else:
            no_secret(body)
            assert {r["auftrag"] for r in body["rows"]} == toks


def test_raw_auftraege_route_is_refused():
    c, up = client_for((200, ok_body(auftraege_rows())))
    assert c.get("/api/ac7/q/auftraege", params={"env": "PROD"}).status_code == 404
    assert up.requests == []


def test_order_token_resolves_to_its_rank_server_side():
    c, up = client_for((200, ok_body(auftraege_rows())), (200, ok_body([kpi_row()])))
    rows = c.get("/api/ac7/auftraege", params={"env": "PROD"}).json()["rows"]
    want = next(r for r in rows if r["rang"] == 2)
    r = c.get("/api/ac7/v/kpi", params={"env": "PROD", "auftrag": want["auftrag_token"]})
    assert r.status_code == 200, r.text
    assert len(up.requests) == 2                                    # auftraege answered from the cache
    sent = up.sent_query()
    assert "VAR _au = 2" in sent
    for a in ORDERS:
        assert a not in sent                                         # the name never travels, only the rank
    assert r.json()["params"].get("auftrag") == want["auftrag_token"] and "auftrag_nr" not in r.json()["params"]


def test_unknown_or_malformed_token_is_400():
    c, up = client_for((200, ok_body(auftraege_rows())))
    assert c.get("/api/ac7/v/liste", params={"env": "PROD", "auftrag": "T-abcdef"}).status_code == 400
    assert c.get("/api/ac7/v/liste", params={"env": "PROD", "auftrag": ORDERS[0]}).status_code == 400
    assert len(up.requests) == 1                                    # only the auftraege lookup reached Fabric


def test_rank_param_is_not_accepted_on_the_view_route():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac7/v/kpi", params={"env": "PROD", "auftrag_nr": "1"}).status_code == 400
    assert up.requests == []


# --------------------------------------------------------------------------- person pseudonym + params

def test_person_filter_resolves_server_side_and_unknown_is_400():
    c, up = client_for((200, ok_body([liste_row("sk-verleih-0001")])), (200, ok_body([liste_row("sk-verleih-0001")])))
    p = c.get("/api/ac7/v/liste", params={"env": "PROD"}).json()["rows"][0]["person_sk"]
    assert c.get("/api/ac7/v/liste", params={"env": "PROD", "person": p}).status_code == 200
    sent = up.sent_query()
    assert "TREATAS ( { \"sk-verleih-0001\" }, fact_au_verleihliste[person_sk] )" in sent and p not in sent
    assert c.get("/api/ac7/v/liste", params={"env": "PROD", "person": "P-abcdef"}).status_code == 400


def test_unfiltered_view_filters_nobody():
    c, up = client_for((200, ok_body([kpi_row()])))
    assert c.get("/api/ac7/v/kpi", params={"env": "QA"}).status_code == 200
    sent = up.sent_query()
    assert "ALL ( fact_au_verleihliste[Status Code] )" in sent and "ALL ( fact_au_verleihliste[person_sk] )" in sent
    for var in ("_ga", "_ta", "_or", "_au", "_j"):
        assert f"VAR {var} = BLANK ()" in sent, var


def test_filters_render_as_literals():
    c, up = client_for((200, ok_body([kpi_row()])))
    r = c.get("/api/ac7/v/kpi", params={"env": "PROD", "status": "AKTIV", "ga": "AU_DL", "taet": "2", "ort": "7", "jahr": "2026"})
    assert r.status_code == 200, r.text
    sent = up.sent_query()
    assert 'TREATAS ( { "AKTIV" }, fact_au_verleihliste[Status Code] )' in sent
    assert 'VAR _ga = "AU_DL"' in sent and "VAR _ta = 2" in sent and "VAR _or = 7" in sent and "VAR _j = 2026" in sent
    assert '"AU_DL", "AÜ+DL"' in sent                                # the ASCII request value maps to the model label


@pytest.mark.parametrize("params", [
    {"status": "aktiv"},                       # enum is exact
    {"status": "NICHT_IN_AUE"},                # unreachable under the lent-only population, not offered
    {"ga": "AÜ"},                              # non-ASCII: the request value is AU / DL / AU_DL
    {"ga": "AU+DL"},
    {"taet": "0"}, {"taet": "Lokführer"},      # rank, never a label
    {"ort": "abc"}, {"ort": "501"},
    {"jahr": "1999"}, {"jahr": "2026-01"},
    {"person": "Rita Erfunden"},               # a pseudonym only
    {"nachname": "Erfunden"},                  # not whitelisted: no name filter, no free-text search
    {"geburtsdatum": "1990-01-01"},
    {"env": "DEV"},
    {"tenant": "CARGOCONTROL"},                # RT&S only
])
def test_param_whitelist(params):
    c, up = client_for((200, ok_body([])))
    q = {"env": "PROD", **params}
    assert c.get("/api/ac7/v/liste", params=q).status_code == 400
    assert up.requests == []                                       # refused before any call to Fabric


def test_unknown_view_is_404():
    c, up = client_for((200, ok_body([])))
    assert c.get("/api/ac7/v/taetigkeiten", params={"env": "PROD"}).status_code == 404
    assert up.requests == []


# --------------------------------------------------------------------------- coordinates (AC-1 route)

def test_locations_join_by_name_and_withhold_address_like():
    orte = [_dax_row({"rang": 1, "ort": PLACE, "personen_einsatz1": 2, "personen_einsatz2": 1, "personen": 3}),
            _dax_row({"rang": 2, "ort": "Erfundenstrasse 12", "personen_einsatz1": 1, "personen_einsatz2": None, "personen": 1})]
    opener = FakeOpener([{"id": 1, "name": PLACE, "latitude": "47.1", "longitude": "7.9"},
                         {"id": 2, "name": "Erfundenstrasse 12", "latitude": "47.2", "longitude": "8.0"}])
    from app.showcases.ac7 import router as ac7_router
    ac7_router._locations.clear()                                # process-lifetime cache of the route
    c, _ = client_for((200, ok_body(orte)), bronze=fake_bronze(opener))
    body = c.get("/api/ac7/locations", params={"env": "PROD"}).json()
    by = {e["status"]: e for e in body["locations"]}
    assert by["ok"]["name"] == PLACE and by["ok"]["lat"] == 47.1
    assert by["withheld"]["name"] is None and by["withheld"]["lat"] is None
    assert "Erfundenstrasse" not in json.dumps(body)
    cols = opener.calls[0][0]
    assert "RTS_PROD" in cols and "abstractcustomlocation" in cols


def test_ping():
    c, _ = client_for((200, ok_body([])))
    assert c.get("/api/ac7/ping").json() == {"showcase": "ac7", "ok": True}
