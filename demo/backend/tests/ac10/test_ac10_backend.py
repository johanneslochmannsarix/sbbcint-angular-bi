"""AC-10 offline tests: query definitions, roles, minimisation (no person column, no tenant id, no absences),
masking end to end, role coverage, param whitelist and rendering. No Fabric, no az. Every name, label and free
text below is an invented fixture."""
from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient

from app.core import forbidden
from app.core import queries as Q
from app.core.masking import TEXT_TOKEN_RE, Masker
from tests.support import Upstream, make_app, ok_body

AC10_DIR = Q.QUERIES_DIR / "ac10"
AC10 = Q.load_queries()["ac10"]
WIN = "date_from=2026-10-17&date_to=2026-10-27"
POS = "a" * 64

# --------------------------------------------------------------------------- fixtures (invented)

SHIFT_NAME = "Früh Erika Erfunden Sonder"
ELEMENT_LIST = "47110 · 47112 · Rangieren Fiktivhausen"
SECRETS = ["Erika", "Erfunden", "Sonder", "47110", "Fiktivhausen"]


def _dax_row(d: dict) -> dict:
    return {f"[{k}]": v for k, v in d.items()}


def tag_row(**kw) -> dict:
    r = {"position_sk": POS, "position_typ": "Schicht", "mandant": "SBB Cargo Testland", "depot": "CT - Musterdepot",
         "haupttyp": "Lokführer", "personaltyp": "CT - Lokführer National", "position_name": SHIFT_NAME,
         "planned_start": "2026-10-21T05:30:00", "planned_end": "2026-10-21T13:30:00", "is_offen": True, "is_zwingend": True,
         "fahren_kategorie": None, "fahrelement_anzahl": 3, "fahrelement_liste": ELEMENT_LIST, "von": "Musterbahnhof",
         "nach": "Beispielstadt"}
    r.update(kw)
    return _dax_row(r)


def scope_rows() -> list[dict]:
    return [_dax_row({"art": "mandant", "ix": 1, "label": "(unbekannt)", "mandant": "(unbekannt)", "n_gesamt": 0, "n_offen": 0,
                      "mandanten": 1}),
            _dax_row({"art": "depot", "ix": 1, "label": "(unbekannt)", "mandant": "(unbekannt)", "n_gesamt": 0, "n_offen": 0,
                      "mandanten": 1}),
            _dax_row({"art": "depot", "ix": 2, "label": "CT - Musterdepot", "mandant": "SBB Cargo Testland", "n_gesamt": 40,
                      "n_offen": 9, "mandanten": 1})]


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

EXPECTED = {"stand", "scope", "jetzt", "fenster", "tage", "depot_tage", "struktur", "personaltypen", "elemente", "tag"}


def test_ac10_queries_load_on_the_offene_schichten_model_only():
    assert set(AC10) == EXPECTED
    for q in AC10.values():
        assert q.model == "offene_schichten" and q.tenant == "CARGOCONTROL", q.qid


def test_every_ac10_dax_has_a_roles_file_a_view_and_a_grain():
    for p in AC10_DIR.rglob("*.dax"):
        assert p.with_suffix(".roles.json").exists(), p.name
    for q in AC10.values():
        assert q.meta.get("view") and q.meta.get("grain") and q.meta.get("replaces"), q.qid


def test_no_person_column_anywhere():
    """The model carries no person column (D0): no query may declare one, so no pseudonym is ever needed."""
    for q in AC10.values():
        assert not [c for c, r in q.roles.items() if r == "label_person"], q.qid
        assert q.person_keys == (), q.qid
    for p in sorted(AC10_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8").lower()
        for col in ("person_sk", "dim_person", "firstname", "lastname", "personnelnumber", "person_nk"):
            assert col not in text, (p.name, col)


def test_free_text_is_masked_and_labels_have_their_roles():
    tag = AC10["tag"].roles
    assert tag["position_name"] == "label_freetext" and tag["fahrelement_liste"] == "label_freetext"
    assert tag["von"] == tag["nach"] == "label_location"
    assert tag["position_sk"] == "id"
    for q in AC10.values():
        for col, role in q.roles.items():
            if col in ("position_name", "fahrelement_liste"):
                assert role == "label_freetext", (q.qid, col)
            if col.endswith("_name") and col not in ("position_name",):
                assert role in ("label_org", "label_technical"), (q.qid, col)


def test_no_tenant_id_or_hidden_key_is_selected():
    """R7: the tenant id behind the SBB Cargo Deutschland fallback is never surfaced; the browser filters by
    ordinal, so no *_sk of the scope dimensions leaves the model either."""
    for p in sorted(AC10_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8").lower()
        for col in ("tenant_sk", "depot_sk", "personaltyp_sk", "scope_sk", "tenant_id", "tenantid", "system_name",
                    "environment_name"):
            assert col not in text, (p.name, col)


_ABSENCE = re.compile(r"absence|abwesen|absenz", re.IGNORECASE)


def test_no_absences_and_no_forbidden_columns():
    hits = []
    for p in sorted(AC10_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        hits += [f"{p.name}: {m.group(0)}" for m in _ABSENCE.finditer(text)]
        hits += [str(v) for v in forbidden.check_text("ac10", text, p.name)]
    assert hits == []


def test_no_epoch_companion_or_foreign_schema():
    for p in sorted(AC10_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8").lower()
        assert "_timezone" not in text and "loclocation" not in text, p.name


def test_ordinal_rule_is_the_same_in_scope_and_every_filter():
    """The int a browser sends is resolved by the same expression scope.dax uses to hand it out."""
    rule = re.compile(r"1 \+ COUNTROWS \( FILTER \( ALL \( ('[a-z_]+'\[[a-z_]+\]) \), NOT ISBLANK \( \1 \) && \1 < EARLIER \( \1 \) \) \)")
    scope_cols = set(rule.findall((AC10_DIR / "scope.dax").read_text(encoding="utf-8")))
    assert scope_cols == {"'dim_scope'[tenant_name]", "'dim_scope'[depot_name]", "'dim_scope'[haupttyp_name]",
                          "'fact_shift_besetzung'[fahren_kategorie]"}
    param_col = {"mandant": "'dim_scope'[tenant_name]", "depot": "'dim_scope'[depot_name]",
                 "haupttyp": "'dim_scope'[haupttyp_name]", "kategorie": "'fact_shift_besetzung'[fahren_kategorie]"}
    for q in AC10.values():
        used = set(rule.findall(q.body))
        for p, col in param_col.items():
            if p in q.params:
                assert col in used, (q.qid, p)
                assert q.params[p].type == "int" and q.params[p].min == 1, (q.qid, p)


def test_zwingend_part_uses_keepfilters():
    """A plain inner pin on is_zwingend_zu_besetzen would override the outer zwingend filter."""
    plain = re.compile(r"\[Anzahl ungeplante Schichten\],\s*'fact_shift_besetzung'\[is_zwingend")
    kept = "[Anzahl ungeplante Schichten], KEEPFILTERS ( 'fact_shift_besetzung'[is_zwingend_zu_besetzen] = TRUE () )"
    for q in AC10.values():
        assert not plain.search(q.body), q.qid
        pins = q.body.count("[is_zwingend_zu_besetzen] = TRUE () )") - q.body.count("&& 'fact_shift_besetzung'[is_zwingend_zu_besetzen] = TRUE () )")
        assert pins == q.body.count(kept), q.qid


# --------------------------------------------------------------------------- masking end to end

def test_tag_masks_free_text_and_keeps_org_labels():
    c, _ = client_for((200, ok_body([tag_row(), tag_row(position_sk="b" * 64, position_name="  ", fahrelement_liste=None)])))
    r = c.get("/api/ac10/q/tag?env=PROD&tag=2026-10-21")
    assert r.status_code == 200, r.text
    body = r.json()
    no_secret(body)
    rows = body["rows"]
    assert TEXT_TOKEN_RE.match(rows[0]["position_name"]) and TEXT_TOKEN_RE.match(rows[0]["fahrelement_liste"])
    assert rows[1]["position_name"] is None and rows[1]["fahrelement_liste"] is None    # blank stays blank
    assert rows[0]["depot"] == "CT - Musterdepot" and rows[0]["von"] == "Musterbahnhof"
    assert body["mode"] == "masked" and body["person_keys"] == []


def test_same_text_gets_the_same_token():
    c, _ = client_for((200, ok_body([tag_row(), tag_row(position_sk="b" * 64)])))
    rows = c.get("/api/ac10/q/tag?env=PROD&tag=2026-10-21").json()["rows"]
    assert rows[0]["position_name"] == rows[1]["position_name"]


def test_real_mode_shows_the_text():
    c, _ = client_for((200, ok_body([tag_row()])), masker=Masker(real=True))
    body = c.get("/api/ac10/q/tag?env=QA&tag=2026-10-21").json()
    assert body["mode"] == "real" and body["rows"][0]["position_name"] == SHIFT_NAME


def test_scope_labels_pass_through_as_delivered():
    c, _ = client_for((200, ok_body(scope_rows())))
    body = c.get("/api/ac10/q/scope?env=PROD").json()
    assert [r["label"] for r in body["rows"]] == ["(unbekannt)", "(unbekannt)", "CT - Musterdepot"]


def test_undeclared_column_is_refused_with_502():
    row = tag_row()
    row["[tenant_sk]"] = "fixture-tenant-key"
    c, _ = client_for((200, ok_body([row])))
    r = c.get("/api/ac10/q/tag?env=PROD&tag=2026-10-21")
    assert r.status_code == 502
    assert "fixture-tenant-key" not in r.text


def test_missing_declared_column_is_refused_with_502():
    row = tag_row()
    del row["[position_name]"]
    c, _ = client_for((200, ok_body([row])))
    assert c.get("/api/ac10/q/tag?env=PROD&tag=2026-10-21").status_code == 502


# --------------------------------------------------------------------------- params

@pytest.mark.parametrize("url", [
    "/api/ac10/q/tag?env=PROD",                                              # tag required
    "/api/ac10/q/tag?env=PROD&tag=2026-13-01",                               # date
    "/api/ac10/q/tag?env=PROD&tag=2026-10-21&position=abc",                  # sk too short
    "/api/ac10/q/tag?env=PROD&tag=2026-10-21&position=" + "a" * 63 + "'",    # sk pattern
    "/api/ac10/q/tag?env=PROD&tag=2026-10-21&tier=alles",                    # enum exact
    f"/api/ac10/q/fenster?env=PROD&{WIN}&mandant=0",                         # ordinal >= 1
    f"/api/ac10/q/fenster?env=PROD&{WIN}&mandant=501",                       # ordinal <= 500
    f"/api/ac10/q/fenster?env=PROD&{WIN}&depot=zwei",                        # int
    f"/api/ac10/q/fenster?env=PROD&{WIN}&depot=CT - Musterdepot",            # labels never travel
    f"/api/ac10/q/fenster?env=PROD&{WIN}&zwingend=ja",                       # enum
    f"/api/ac10/q/fenster?env=PROD&{WIN}&zwingend=Zwingend",                 # enum is exact
    f"/api/ac10/q/depot_tage?env=PROD&{WIN}&depot=2",                        # heatmap shows all depots
    f"/api/ac10/q/struktur?env=PROD&{WIN}&mandant=1",                        # struktur is the picker
    f"/api/ac10/q/elemente?env=PROD&{WIN}&mandant=1",                        # tier 2 has no Mandant
    f"/api/ac10/q/fenster?env=PROD&{WIN}&tenant_sk=x",                       # not whitelisted
    "/api/ac10/q/tage?env=PROD&date_from=2026-01-01&date_to=2027-12-31",     # window > 400 days
    f"/api/ac10/q/tage?env=PROD&date_from=2026-10-27&date_to=2026-10-17",    # from after to
    f"/api/ac10/q/tage?env=DEV&{WIN}",                                       # env
    f"/api/ac10/q/tage?env=PROD&tenant=RTS&{WIN}",                           # CargoControl only
    f"/api/ac10/q/tage?env=PROD&{WIN}&mandant=1&mandant=2",                  # given twice
])
def test_param_whitelist(url):
    c, up = client_for((200, ok_body([])))
    assert c.get(url).status_code == 400
    assert up.requests == []                                     # refused before any call to Fabric


def test_ordinals_render_as_integers_and_absent_filters_as_blank():
    c, up = client_for((200, ok_body([])), (200, ok_body([])))
    assert c.get(f"/api/ac10/q/fenster?env=PROD&{WIN}&mandant=3&haupttyp=12&zwingend=nicht").status_code == 200
    sent = up.sent_query()
    assert "VAR _mix = 3" in sent and "VAR _hix = 12" in sent and 'VAR _z = "nicht"' in sent
    assert "VAR _dix = BLANK ()" in sent and "VAR _kix = BLANK ()" in sent
    assert "DATE ( 2026, 10, 17 )" in sent and "DATE ( 2026, 10, 27 )" in sent
    assert c.get(f"/api/ac10/q/fenster?env=QA&{WIN}").status_code == 200
    sent = up.sent_query()
    assert "VAR _mix = BLANK ()" in sent and "VAR _z = BLANK ()" in sent


def test_position_filter_renders_treatas_and_all_when_absent():
    c, up = client_for((200, ok_body([])), (200, ok_body([])))
    assert c.get(f"/api/ac10/q/tag?env=PROD&tag=2026-10-21&position={POS}&tier=schicht").status_code == 200
    sent = up.sent_query()
    assert f"TREATAS ( {{ \"{POS}\" }}, 'fact_shift_besetzung'[position_sk] )" in sent
    assert 'VAR _tier = "schicht"' in sent and "VAR _t = DATE ( 2026, 10, 21 )" in sent
    assert c.get("/api/ac10/q/tag?env=PROD&tag=2026-10-21").status_code == 200
    assert "ALL ( 'fact_shift_besetzung'[position_sk] )" in up.sent_query()


def test_jetzt_defaults_to_the_backend_today_and_takes_an_explicit_one():
    c, up = client_for((200, ok_body([])), (200, ok_body([])))
    assert c.get("/api/ac10/q/jetzt?env=PROD").status_code == 200
    assert "VAR _h = DATE ( 2026, 10, 20 )" in up.sent_query()            # tests.support.TODAY
    assert c.get("/api/ac10/q/jetzt?env=PROD&heute=2026-10-21").status_code == 200
    assert "VAR _h = DATE ( 2026, 10, 21 )" in up.sent_query()


def test_responses_are_cached_per_param_set():
    c, up = client_for((200, ok_body([])))
    for _ in range(3):
        assert c.get(f"/api/ac10/q/tage?env=PROD&{WIN}&mandant=2").status_code == 200
    assert len(up.requests) == 1
    assert c.get(f"/api/ac10/q/tage?env=PROD&{WIN}&mandant=3").status_code == 200
    assert len(up.requests) == 2


def test_ping_and_query_list():
    c, _ = client_for((200, ok_body([])))
    assert c.get("/api/ac10/ping").json() == {"showcase": "ac10", "ok": True}
    listed = {q["name"] for q in c.get("/api/ac10/queries").json()["queries"]}
    assert listed == EXPECTED
