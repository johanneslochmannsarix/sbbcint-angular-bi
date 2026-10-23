"""Forbidden columns (core/forbidden.py): absence reasons and birth dates everywhere, IST times in AC-1."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core import forbidden as F
from app.core import queries as Q
from tests.support import Upstream, make_app, make_client, meta, ok_body, write_query


def test_real_query_tree_has_no_forbidden_column():
    """Fails as soon as any showcase's .dax references a forbidden column."""
    assert F.check_tree(Q.QUERIES_DIR) == []


@pytest.mark.parametrize("showcase, text", [
    ("ac8", "EVALUATE VALUES ( 'dim_absence_type'[type_name] )"),
    ("ac8", "EVALUATE VALUES ( 'fact_absence'[absence_name] )"),
    ("ac8", "EVALUATE SUMMARIZECOLUMNS ( 'fact_absence'[absence_type_sk] )"),
    ("ac2", "EVALUATE VALUES ( 'DIM_ABSENCE_TYPE'[x] )"),
    ("ac1", "-- comment naming absence_name still fails\nEVALUATE ROW ( \"n\", 1 )"),
    ("ac2", "EVALUATE ROW ( \"n\", MAX ( 'dim_person'[date_of_birth] ) )"),
    ("ac8", "EVALUATE ROW ( \"n\", MAX ( 'dim_person'[geburtsdatum] ) )"),
    ("ac1", "EVALUATE ROW ( \"n\", MAX ( 'x'[executedstart] ) )"),
    ("ac1", "EVALUATE ROW ( \"n\", MAX ( 'x'[doi_executedend_dt] ) )"),
    ("ac1", "EVALUATE ROW ( \"n\", MAX ( 'x'[ist_start] ) )"),
    ("ac1", "EVALUATE ROW ( \"n\", MAX ( 'x'[ist_dauer_h] ) )"),
    ("ac1", "EVALUATE ROW ( \"n\", MAX ( 'x'[actualdistance] ) )"),
    ("ac2", "EVALUATE ROW ( \"n\", MAX ( 'dim_person'[personnelnumber] ) )"),
    ("ac2", "EVALUATE ROW ( \"n\", MAX ( dim_person[firstname] ) )"),
])
def test_forbidden_patterns_hit(showcase, text):
    assert F.check_text(showcase, text), text


@pytest.mark.parametrize("showcase, text", [
    ("ac8", "EVALUATE SUMMARIZECOLUMNS ( 'fact_absence'[start_date], \"n\", COUNTROWS ( 'fact_absence' ) )"),
    ("ac8", "EVALUATE VALUES ( 'fact_shift'[ist_kommuniziert] )"),       # IST rule is AC-1 only, and not this
    ("ac8", "EVALUATE VALUES ( 'dim_person'[personnelnumber] )"),        # AC-8 masks it; AC-2 rule only
    ("ac1", "EVALUATE VALUES ( 'fact_person_tour_day'[start_time] )"),
    ("ac2", "EVALUATE ROW ( \"n\", 1 ) -- executedstart is an AC-1 rule"),
])
def test_rules_are_scoped(showcase, text):
    assert F.check_text(showcase, text) == []


def test_ist_rule_applies_under_queries_ac1_only(tmp_path):
    d = tmp_path / "q"
    write_query(d, "ac8", "ok", 'EVALUATE ROW ( "n", MAX ( \'x\'[executedstart] ) )\n',
                meta(model="leitstelle_olten", tenant="CARGOCONTROL", columns={"n": "measure"}))
    assert F.check_tree(d) == []
    write_query(d, "ac1", "bad", 'EVALUATE ROW ( "n", MAX ( \'x\'[executedstart] ) )\n', meta(columns={"n": "measure"}))
    v = F.check_tree(d)
    assert len(v) == 1 and v[0].path == "ac1/bad.dax" and "plan-only" in v[0].reason


def test_create_app_refuses_to_start_on_a_forbidden_column(tmp_path):
    from app.main import create_app
    d = write_query(tmp_path / "q", "ac8", "absent", 'EVALUATE ROW ( "n", MAX ( \'fact_absence\'[absence_name] ) )\n',
                    meta(model="leitstelle_olten", tenant="CARGOCONTROL", columns={"n": "measure"}))
    with pytest.raises(F.ForbiddenColumnError, match="absence reason"):
        create_app(client=make_client(Upstream((200, ok_body([])))), queries_dir=d)


def test_lists_have_one_home():
    assert {r.reason.split(" (")[0] for r in F.GLOBAL} == {"absence reason", "date of birth"}
    assert set(F.PER_SHOWCASE) == {"ac1", "ac2"}
    assert F.rules_for("ac8") == F.GLOBAL


def test_app_with_clean_fixture_tree_starts(qdir):
    app, _ = make_app(Upstream((200, ok_body([]))), queries_dir=qdir)
    with TestClient(app) as c:
        assert c.get("/api/ac1/ping").status_code == 200
