"""AC-8 offline tests: query definitions, roles, no absence reasons, minimisation, masking end to end, role
coverage, server-side person resolution, param whitelist. No Fabric, no az. Every name, key and free text
below is an invented fixture."""
from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient

from app.core import forbidden
from app.core import queries as Q
from app.core.masking import PSEUDONYM_RE, TEXT_TOKEN_RE, Masker
from tests.support import Upstream, make_app, ok_body

AC8_DIR = Q.QUERIES_DIR / "ac8"
AC8 = Q.load_queries()["ac8"]
WIN = "date_from=2026-10-19&date_to=2026-11-15"

# --------------------------------------------------------------------------- fixtures (invented)

PEOPLE = {"sk-olten-0001": "Rita Erfunden", "sk-olten-0002": "Beat Fiktiv"}
SHIFT_NAME = "Früh Rita Erfunden Spezial"
SECRETS = ["Rita", "Erfunden", "Beat", "Fiktiv", "Spezial", *PEOPLE]


def _dax_row(d: dict) -> dict:
    return {f"[{k}]": v for k, v in d.items()}


def shift_row(person: str | None, **kw) -> dict:
    r = {"shift_sk": "shift-0001", "person_sk": person, "shift_name": SHIFT_NAME, "planned_date": "2026-10-20T00:00:00",
         "planned_start": "2026-10-20T06:00:00", "planned_end": "2026-10-20T14:00:00",
         "shift_worker_type_name": "CINT (CH) - Disponent Leitstelle", "ist_kommuniziert": True,
         "kommunikationsstand": "kommuniziert", "rueckmeldung_status": 2, "rueckmeldung_status_label": "akzeptiert",
         "kommuniziert_start": "2026-10-20T06:00:00", "kommuniziert_ende": "2026-10-20T14:00:00",
         "juengster_stand_start": "2026-10-20T06:00:00", "juengster_stand_ende": "2026-10-20T14:00:00",
         "weicht_von_juengstem_stand_ab": False}
    r.update(kw)
    return _dax_row(r)


def dienstplan_row(person: str | None, plan_person: str | None) -> dict:
    return _dax_row({"shift_sk": "shift-0001", "shift_snapshot_sk": "snap-0001", "person_sk": person,
                     "plan_person_sk": plan_person, "shift_name": SHIFT_NAME,
                     "shift_worker_type_name": "CINT (CH) - Disponent Leitstelle", "dienstplan_datum": "2026-10-20T00:00:00",
                     "dienstplan_start": "2026-10-20T06:00:00", "dienstplan_ende": "2026-10-20T14:00:00",
                     "plan_start": "2026-10-20T07:00:00", "plan_ende": "2026-10-20T15:00:00",
                     "dienstplan_quelle": "vorheriger Stand – Änderung nicht kommuniziert",
                     "rueckmeldung_status_label": "akzeptiert", "schicht_im_plan": True, "weicht_vom_plan_ab": True})


def person_rows() -> list[dict]:
    return [_dax_row({"person_sk": k, "person_name": v, "worker_type_name": "CINT (CH) - Disponent Leitstelle",
                      "is_active": True}) for k, v in PEOPLE.items()]


_OPEN: list[TestClient] = []


@pytest.fixture(autouse=True)
def _close_clients():
    yield
    while _OPEN:
        _OPEN.pop().__exit__(None, None, None)


def client_for(*answers, masker: Masker | None = None):
    """A started TestClient (lifespan entered, so app.state.core exists); closed after the test."""
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

def test_ac8_queries_load_on_the_olten_model_only():
    assert {"stand", "kpi", "pipeline", "river", "versions", "shift_versions", "shifts", "dienstplan", "soll",
            "plannings", "persons"} <= set(AC8)
    for q in AC8.values():
        assert q.model == "leitstelle_olten" and q.tenant == "CARGOCONTROL", q.qid


def test_every_ac8_dax_has_a_roles_file_and_a_view():
    for p in AC8_DIR.rglob("*.dax"):
        assert p.with_suffix(".roles.json").exists(), p.name
    for q in AC8.values():
        assert q.meta.get("view") and q.meta.get("grain"), q.qid


def test_person_and_freetext_columns_carry_masked_roles():
    for q in AC8.values():
        for col, role in q.roles.items():
            if col in ("person_sk", "plan_person_sk", "person_name"):
                assert role == "label_person", (q.qid, col)
            if col == "shift_name":
                assert role == "label_freetext", (q.qid, col)


def test_person_keys_are_declared_where_persons_are_returned():
    for q in AC8.values():
        returned = [c for c, r in q.roles.items() if r == "label_person"]
        for c in returned:
            assert c in q.person_keys or c in q.label_of, (q.qid, c)
    assert set(AC8["dienstplan"].person_keys) == {"person_sk", "plan_person_sk"}
    assert set(AC8["shift_versions"].person_keys) == {"person_sk", "plan_person_sk"}


def test_scatter_and_aggregates_return_no_person_column():
    for qid in ("stand", "kpi", "pipeline", "river", "versions", "soll", "plannings"):
        assert not [c for c, r in AC8[qid].roles.items() if r in ("label_person", "label_freetext")], qid


# --------------------------------------------------------------------------- no absence reasons (PLAN §13.3)

_ABSENCE_REASON = re.compile(r"dim_absence_type|absence_name|absence_type|absenz_?grund|abwesenheits_?(art|grund|typ)",
                             re.IGNORECASE)


def test_no_ac8_dax_references_absence_reasons():
    hits = []
    for p in sorted(AC8_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8")
        hits += [f"{p.name}: {m.group(0)}" for m in _ABSENCE_REASON.finditer(text)]
        hits += [str(v) for v in forbidden.check_text("ac8", text, p.name)]
    assert hits == []


def test_no_ac8_roles_declare_absence_reason_columns():
    for q in AC8.values():
        assert not [c for c in q.roles if _ABSENCE_REASON.search(c)], q.qid


def test_absence_reason_rule_is_wired_in_the_core():
    assert forbidden.check_text("ac8", "EVALUATE VALUES ( 'dim_absence_type'[type_name] )")
    assert forbidden.check_text("ac8", "EVALUATE VALUES ( 'fact_absence'[absence_name] )")
    assert forbidden.check_text("ac8", "TREATAS ( x, 'fact_absence'[absence_type_sk] )")


def test_absences_are_read_as_windows_only():
    text = (AC8_DIR / "kpi.dax").read_text(encoding="utf-8")
    cols = set(re.findall(r"'fact_absence'\[([a-z_]+)\]", text))
    assert cols == {"start_date", "end_date"}


# --------------------------------------------------------------------------- minimisation

def test_no_first_last_name_or_personnel_number():
    for p in sorted(AC8_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8").lower()
        for col in ("firstname", "lastname", "personnelnumber", "person_nk"):
            assert col not in text, (p.name, col)


def test_no_epoch_companion_or_foreign_schema():
    for p in sorted(AC8_DIR.rglob("*.dax")):
        text = p.read_text(encoding="utf-8").lower()
        assert "_timezone" not in text and "loclocation" not in text, p.name


# --------------------------------------------------------------------------- masking end to end

def test_shifts_masks_person_and_shift_name():
    c, up = client_for((200, ok_body([shift_row("sk-olten-0001"), shift_row(None, kommunikationsstand="unbesetzt")])))
    r = c.get(f"/api/ac8/q/shifts?env=PROD&{WIN}")
    assert r.status_code == 200, r.text
    body = r.json()
    no_secret(body)
    rows = body["rows"]
    assert PSEUDONYM_RE.match(rows[0]["person_sk"]) and rows[1]["person_sk"] is None
    assert TEXT_TOKEN_RE.match(rows[0]["shift_name"])
    assert body["mode"] == "masked" and body["person_keys"] == ["person_sk"]


def test_dienstplan_masks_both_person_keys_and_keeps_them_stable_across_queries():
    c, _ = client_for((200, ok_body([dienstplan_row("sk-olten-0001", "sk-olten-0002")])),
                      (200, ok_body([shift_row("sk-olten-0002")])),
                      (200, ok_body(person_rows())))
    dp = c.get(f"/api/ac8/q/dienstplan?env=PROD&{WIN}").json()
    sh = c.get(f"/api/ac8/q/shifts?env=PROD&{WIN}").json()
    pe = c.get("/api/ac8/q/persons?env=PROD").json()
    for b in (dp, sh, pe):
        no_secret(b)
    shown, plan = dp["rows"][0]["person_sk"], dp["rows"][0]["plan_person_sk"]
    assert PSEUDONYM_RE.match(shown) and PSEUDONYM_RE.match(plan) and shown != plan
    assert sh["rows"][0]["person_sk"] == plan                     # same person, same pseudonym, other query
    names = {r["person_sk"]: r["person_name"] for r in pe["rows"]}
    assert names[shown] == shown and names[plan] == plan          # masked name = the pseudonym


def test_real_mode_shows_names_but_keeps_the_key_a_pseudonym():
    c, _ = client_for((200, ok_body(person_rows())), masker=Masker(real=True))
    body = c.get("/api/ac8/q/persons?env=PROD").json()
    assert body["mode"] == "real"
    assert {r["person_name"] for r in body["rows"]} == set(PEOPLE.values())
    assert all(PSEUDONYM_RE.match(r["person_sk"]) for r in body["rows"])


def test_undeclared_column_is_refused_with_502():
    row = shift_row("sk-olten-0001")
    row["[lastname]"] = "Erfunden"
    c, _ = client_for((200, ok_body([row])))
    r = c.get(f"/api/ac8/q/shifts?env=PROD&{WIN}")
    assert r.status_code == 502
    assert "Erfunden" not in r.text


def test_missing_declared_column_is_refused_with_502():
    row = shift_row("sk-olten-0001")
    del row["[shift_name]"]
    c, _ = client_for((200, ok_body([row])))
    assert c.get(f"/api/ac8/q/shifts?env=PROD&{WIN}").status_code == 502


# --------------------------------------------------------------------------- params

def test_person_filter_resolves_server_side_and_unknown_is_400():
    c, up = client_for((200, ok_body([dienstplan_row("sk-olten-0001", "sk-olten-0002")])),
                       (200, ok_body([dienstplan_row("sk-olten-0001", "sk-olten-0002")])))
    p = c.get(f"/api/ac8/q/dienstplan?env=PROD&{WIN}").json()["rows"][0]["person_sk"]
    r = c.get(f"/api/ac8/q/dienstplan?env=PROD&{WIN}&person={p}")
    assert r.status_code == 200
    sent = up.sent_query()
    assert "TREATAS ( { \"sk-olten-0001\" }, 'fact_dienstplan'[person_sk] )" in sent
    assert p not in sent
    assert c.get(f"/api/ac8/q/dienstplan?env=PROD&{WIN}&person=P-abcdef").status_code == 400


def test_first_dienstplan_request_filters_nobody():
    c, up = client_for((200, ok_body([])))
    assert c.get(f"/api/ac8/q/dienstplan?env=PROD&{WIN}").status_code == 200
    assert "ALL ( 'fact_dienstplan'[person_sk] )" in up.sent_query()


@pytest.mark.parametrize("url", [
    "/api/ac8/q/soll?env=PROD",                                              # planning required
    "/api/ac8/q/soll?env=PROD&planning=x'y",                                 # sk pattern
    f"/api/ac8/q/kpi?env=PROD&{WIN}",                                        # grain required
    f"/api/ac8/q/kpi?env=PROD&{WIN}&grain=monat",                            # enum
    f"/api/ac8/q/kpi?env=PROD&{WIN}&grain=tag&worker=Disponent",             # enum is exact
    f"/api/ac8/q/pipeline?env=PROD&{WIN}&lead_min=zwei",                     # int
    f"/api/ac8/q/pipeline?env=PROD&{WIN}&brush_from=2026-13-01",             # date
    f"/api/ac8/q/river?env=PROD&{WIN}",                                      # serie required
    f"/api/ac8/q/shifts?env=PROD&{WIN}&depot=Olten",                         # not whitelisted
    "/api/ac8/q/shifts?env=PROD&date_from=2026-01-01&date_to=2027-12-31",    # window > 400 days
    f"/api/ac8/q/shifts?env=DEV&{WIN}",                                      # env
    f"/api/ac8/q/shifts?env=PROD&tenant=RTS&{WIN}",                          # Olten is CargoControl only
])
def test_param_whitelist(url):
    c, up = client_for((200, ok_body([])))
    assert c.get(url).status_code == 400
    assert up.requests == []                                     # refused before any call to Fabric


def test_kpi_renders_grain_and_worker_as_literals():
    c, up = client_for((200, ok_body([])))
    assert c.get(f"/api/ac8/q/kpi?env=QA&{WIN}&grain=woche&worker=disponent").status_code == 200
    sent = up.sent_query()
    assert 'VAR _g = "woche"' in sent and 'VAR _w = "disponent"' in sent
    assert "DATE ( 2026, 10, 19 )" in sent and "DATE ( 2026, 11, 15 )" in sent


def test_unbrushed_pipeline_sends_blanks():
    c, up = client_for((200, ok_body([])))
    assert c.get(f"/api/ac8/q/pipeline?env=PROD&{WIN}").status_code == 200
    sent = up.sent_query()
    assert "VAR _bf = BLANK ()" in sent and "VAR _lmin = BLANK ()" in sent


def test_ping():
    c, _ = client_for((200, ok_body([])))
    assert c.get("/api/ac8/ping").json() == {"showcase": "ac8", "ok": True}
