"""IRON RULE in code: the one masking layer, role coverage and server-side pseudonym resolution."""
from __future__ import annotations

import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from app.core.cache import ResponseCache
from app.core.masking import PSEUDONYM_RE, TEXT_TOKEN_RE, Masker
from tests.support import Clock, Upstream, make_app, make_client, ok_body

# invented person fixtures: none of these strings may survive masking
FAKE_PEOPLE = [
    {"sk": "1f" * 32, "name": "Muster, Anna"},
    {"sk": "2e" * 32, "name": "Beispiel, Bruno"},
    {"sk": "3d" * 32, "name": "Zürcher-Ölmann, Chloé"},
]
NOTE = "TN: Beispiel Bruno / Prüfer: Muster Anna"


def persons_body(people=FAKE_PEOPLE, blank_last=False) -> dict:
    rows = []
    for i, p in enumerate(people):
        name = "" if (blank_last and i == len(people) - 1) else p["name"]
        rows.append({"dim_person[person_sk]": p["sk"], "dim_person[person_name]": name, "[hours]": 7.5})
    return ok_body(rows)


def notes_body() -> dict:
    return ok_body([{"[person_sk]": p["sk"], "[beschreibung]": NOTE, "[dor_name]": "Kurs 2026-A",
                     "[start_location]": "Olten"} for p in FAKE_PEOPLE])


def assert_no_person_string(text: str) -> None:
    for p in FAKE_PEOPLE:
        for s in (p["sk"], p["name"], p["name"].split(",")[0], p["name"].split(", ")[1]):
            assert s not in text, "a person string survived masking"
    for s in (NOTE, "Bruno", "Anna"):
        assert s not in text, "a free-text string survived masking"


def test_masked_response_contains_no_person_string(qdir):
    app, _ = make_app(Upstream((200, persons_body())), queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/persons", params={"env": "PROD"})
    assert r.status_code == 200
    assert_no_person_string(r.text)
    body = r.json()
    assert body["mode"] == "masked" and body["person_keys"] == ["person_sk"]
    assert body["roles"] == {"person_sk": "label_person", "person_name": "label_person", "hours": "measure"}
    for row in body["rows"]:
        assert PSEUDONYM_RE.match(row["person_sk"]) and row["person_name"] == row["person_sk"]
        assert row["hours"] == 7.5


def test_freetext_is_tokenised_and_org_location_stay_readable(qdir):
    app, _ = make_app(Upstream((200, notes_body())), queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/notes", params={"env": "PROD"})
    assert r.status_code == 200
    assert_no_person_string(r.text)
    rows = r.json()["rows"]
    assert all(TEXT_TOKEN_RE.match(x["beschreibung"]) for x in rows)
    assert len({x["beschreibung"] for x in rows}) == 1                 # same text -> same token
    assert rows[0]["dor_name"] == "Kurs 2026-A" and rows[0]["start_location"] == "Olten"


def test_blank_name_stays_null_not_pseudonym(qdir):
    app, _ = make_app(Upstream((200, persons_body(blank_last=True))), queries_dir=qdir)
    with TestClient(app) as c:
        rows = c.get("/api/ac1/q/persons", params={"env": "PROD"}).json()["rows"]
    assert rows[-1]["person_name"] is None and PSEUDONYM_RE.match(rows[-1]["person_sk"])
    assert rows[0]["person_name"] is not None


def test_same_person_same_pseudonym_across_showcases_in_one_process(qdir):
    """D2 cross-links: AC-1 and AC-2 on RT&S see the same pseudonym for the same person key."""
    masker = Masker(real=False)
    app, _ = make_app(Upstream((200, persons_body())), masker=masker, queries_dir=qdir)
    with TestClient(app) as c:
        a = c.get("/api/ac1/q/persons", params={"env": "PROD"}).json()["rows"]
        b = c.get("/api/ac2/q/persons", params={"tenant": "RTS", "env": "QA"}).json()["rows"]
        cc = c.get("/api/ac2/q/persons", params={"tenant": "CARGOCONTROL", "env": "PROD"}).json()["rows"]
        o = c.get("/api/ac8/q/persons", params={"env": "PROD"}).json()["rows"]
    assert [r["person_sk"] for r in a] == [r["person_sk"] for r in b]          # ac1 == ac2 (RT&S)
    assert [r["person_sk"] for r in cc] == [r["person_sk"] for r in o]         # ac2 CC == ac8 (CC)
    assert not set(r["person_sk"] for r in a) & set(r["person_sk"] for r in cc)  # tenants never collide


def test_pseudonyms_stable_within_process_and_differ_across_keys():
    m1, m2 = Masker(real=False), Masker(real=False)
    sk, sk2 = "a" * 64, "b" * 64
    a = m1.pseudonym(sk, "RTS")
    assert a == m1.pseudonym(sk, "RTS") and a != m1.pseudonym(sk2, "RTS")
    assert a != m2.pseudonym(sk, "RTS")                     # random per-process key
    assert a != m1.pseudonym(sk, "CARGOCONTROL")            # tenant is part of the identity
    assert m1.resolve(a).key == sk and m1.resolve(a, "RTS").tenant == "RTS"
    assert m1.resolve(a, "CARGOCONTROL") is None            # never resolved into another tenant
    assert m1.resolve("P-000000") is None
    assert m1.text_token("x") != m2.text_token("x")


def test_pseudonym_collision_gets_longer():
    m = Masker(real=False)
    sk = "a" * 64
    digest = hmac.new(m._key, "\x1f".join(["person", "RTS", sk]).encode(), hashlib.sha256).hexdigest()
    m._by_pseudonym["P-" + digest[:6]] = object()           # another person already holds the short form
    p = m.pseudonym(sk, "RTS")
    assert len(p) == 2 + 8 and m.resolve(p).key == sk


def test_real_mode_only_with_demo_real_env(monkeypatch):
    for v in (None, "0", "true", "yes", " 1"):
        if v is None:
            monkeypatch.delenv("DEMO_REAL", raising=False)
        else:
            monkeypatch.setenv("DEMO_REAL", v)
        assert Masker().real is False, v
    monkeypatch.setenv("DEMO_REAL", "1")
    m = Masker()
    assert m.real is True and m.mode == "real"
    rows = m.mask_rows([{"person_sk": "a" * 64, "person_name": "Muster, Anna", "beschreibung": NOTE}],
                       {"person_sk": "label_person", "person_name": "label_person", "beschreibung": "label_freetext"},
                       "RTS", ("person_sk",), {"person_name": "person_sk"})
    assert rows[0]["person_name"] == "Muster, Anna" and rows[0]["beschreibung"] == NOTE
    assert rows[0]["person_sk"] != "a" * 64                  # the key stays a pseudonym in every mode


def test_masked_payload_is_what_gets_cached(qdir):
    up = Upstream((200, persons_body()))
    cache = ResponseCache(clock=Clock())
    from app.main import create_app
    from tests.support import TODAY, fake_bronze
    app = create_app(client=make_client(up), cache=cache, masker=Masker(real=False), bronze=fake_bronze(),
                     today=lambda: TODAY, queries_dir=qdir)
    with TestClient(app) as c:
        c.get("/api/ac1/q/persons", params={"env": "PROD"})
    stored = json.dumps([v for _, v in cache._data.values()])
    assert_no_person_string(stored)


def test_mask_rows_refuses_label_without_key():
    with pytest.raises(ValueError):
        Masker(real=False).mask_rows([{"person_name": "x"}], {"person_name": "label_person"}, "RTS")
    with pytest.raises(ValueError):
        Masker(real=False).mask_rows([{"person_sk": "x"}], {"person_sk": "label_person"}, None, ("person_sk",))


# ----------------------------------------------------------------------- role coverage

def test_undeclared_column_is_502_never_passthrough(qdir):
    rows = [{"dim_person[person_sk]": FAKE_PEOPLE[0]["sk"], "dim_person[person_name]": "Muster, Anna",
             "[hours]": 1, "dim_person[personnelnumber]": "4711"}]
    app, _ = make_app(Upstream((200, ok_body(rows))), queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/persons", params={"env": "PROD"})
    assert r.status_code == 502 and "undeclared column" in r.json()["error"]
    assert "4711" not in r.text and "Muster" not in r.text


def test_missing_declared_column_is_502(qdir):
    rows = [{"dim_person[person_sk]": "a" * 64, "[hours]": 1}]
    app, _ = make_app(Upstream((200, ok_body(rows))), queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/persons", params={"env": "PROD"})
    assert r.status_code == 502 and "missing from the result" in r.json()["error"]


def test_zero_rows_is_200_and_empty(qdir):
    app, _ = make_app(Upstream((200, ok_body([]))), queries_dir=qdir)
    with TestClient(app) as c:
        r = c.get("/api/ac1/q/persons", params={"env": "PROD"})
    assert r.status_code == 200 and r.json()["rows"] == [] and r.json()["columns"]


def test_transform_output_is_coverage_checked_and_masked(qdir):
    """A server-side transform (AC-1 tag parser) sees raw rows; its output is checked and masked."""
    import asyncio

    from app.core import queries as Q
    from app.core.service import QueryService, RoleCoverageError

    reg = Q.load_queries(qdir)

    def count_tags(rows, _params):
        return [{**r, "tn_count": str(r["beschreibung"]).count("TN:")} for r in rows]

    def leak(rows, _params):
        return [{**r, "raw_note": r["beschreibung"]} for r in rows]

    svc = QueryService(make_client(Upstream((200, notes_body()))), reg, ResponseCache(clock=Clock()), Masker(real=False))
    out = asyncio.run(svc.run("ac1", "notes", {"env": "PROD"}, transform=count_tags))
    assert out["roles"]["tn_count"] == "measure" and out["rows"][0]["tn_count"] == 1
    assert_no_person_string(json.dumps(out))
    with pytest.raises(RoleCoverageError, match="raw_note"):
        asyncio.run(svc.run("ac1", "notes", {"env": "PROD"}, transform=leak))


# ----------------------------------------------------------------------- pseudonym filters

# Fixed masker keys, so the pseudonyms are deterministic. With a random key this test failed in ~6 % of runs
# (D2, 2026-10-21): when person 1's 6-hex pseudonym had no a-f letter (p = (10/16)^6), `pseudo.upper()` was
# the pseudonym itself, resolved, and got 200 instead of the expected 400. The test was wrong, not masking.py.
DIGITS_ONLY_KEY = bytes.fromhex("720e330176a0100d71160c0ab56d561e03c4b0b3c53fe5b753bfdcd73d16ae9e")
WITH_LETTERS_KEY = b"\x01" * 32


def case_mangled(pseudo: str) -> list[str]:
    """Spellings of a valid pseudonym that differ from it only in case; each must be refused."""
    out = ["p" + pseudo[1:]]
    if pseudo.upper() != pseudo:
        out.append(pseudo.upper())
    return out


@pytest.mark.parametrize("key", [DIGITS_ONLY_KEY, WITH_LETTERS_KEY], ids=["digits-only", "with-letters"])
def test_pseudonym_filter_resolves_server_side_and_never_sends_a_name(qdir, key):
    m = Masker(real=False, key=key)
    up = Upstream((200, persons_body()), (200, ok_body([{"[n]": 1, "[a]": "ausbilder", "[d]": None, "[m]": None, "[q]": None}])),
                  (200, persons_body()))
    app, _ = make_app(up, masker=m, queries_dir=qdir)
    with TestClient(app) as c:
        pseudo = c.get("/api/ac1/q/persons", params={"env": "PROD"}).json()["rows"][1]["person_sk"]
        r = c.get("/api/ac1/q/params", params={"env": "PROD", "person": pseudo, "audience": "ausbilder"})
        assert r.status_code == 200, r.text
        assert r.json()["params"]["person"] == pseudo                   # the echo holds the pseudonym only
        dax = up.sent_query()
        assert f'TREATAS ( {{ "{FAKE_PEOPLE[1]["sk"]}" }}, \'dim_person\'[person_sk] )' in dax
        assert FAKE_PEOPLE[1]["name"] not in dax
        assert (pseudo[2:].isdigit()) == (key == DIGITS_ONLY_KEY)       # both cases really are covered
        unknown = next(f"P-{x * 6}" for x in "abcdef" if m.resolve(f"P-{x * 6}") is None)
        bad = [{"person": unknown}, {"person": "Muster"}] + [{"person": s} for s in case_mangled(pseudo)]
        for b in bad:
            assert c.get("/api/ac1/q/params", params={"env": "PROD", "audience": "ausbilder", **b}).status_code == 400
        # an RT&S pseudonym must not resolve on a CargoControl dataset
        cc = c.get("/api/ac8/q/persons", params={"env": "PROD"})
        assert cc.status_code == 200
    assert m.resolve(pseudo, "CARGOCONTROL") is None


def test_label_technical_is_a_passthrough_role():
    """Option B: names of technical objects (steps, tables, activities, Spark stages) are not person data."""
    rows = [{"step": "silver_entity_x", "key": "public_table_y", "n": 3}]
    m = Masker(real=False)
    roles = {"step": "label_technical", "key": "label_technical", "n": "measure"}
    assert m.mask_rows(rows, roles, None) == rows
    assert len(m) == 0
