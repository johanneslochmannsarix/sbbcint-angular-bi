"""A fixture queries/ tree for the core tests, so they do not depend on any showcase's real queries."""
from __future__ import annotations

import pytest

from tests.support import meta, write_query

PERSONS_DAX = """EVALUATE
SUMMARIZECOLUMNS ( 'dim_person'[person_sk], 'dim_person'[person_name], "hours", [Tour-Stunden] )
"""
PERSONS_COLS = {"person_sk": "label_person", "person_name": "label_person", "hours": "measure"}

NOTES_DAX = """EVALUATE
SELECTCOLUMNS ( 'fact_person_tour_day', "person_sk", [person_sk], "beschreibung", [beschreibung],
    "dor_name", [dor_name], "start_location", [start_location] )
"""

PARAMS_DAX = """EVALUATE
CALCULATETABLE (
    ROW ( "n", {{hour}}, "a", {{audience}}, "d", {{day}}, "m", {{month}}, "q", {{qual}} ),
    {{person_filter}},
    {{depot_filter}}
)
"""

WINDOW_DAX = """EVALUATE
ROW ( "n", COUNTROWS ( FILTER ( 'dim_date', 'dim_date'[date] >= {{date_from}} && 'dim_date'[date] <= {{date_to}} ) ) )
"""


@pytest.fixture
def qdir(tmp_path):
    base = tmp_path / "queries"
    write_query(base, "ac1", "persons", PERSONS_DAX, meta(columns=PERSONS_COLS, person_key="person_sk"))
    write_query(base, "ac2", "persons", PERSONS_DAX, meta(tenant="param", columns=PERSONS_COLS, person_key="person_sk"))
    write_query(base, "ac8", "persons", PERSONS_DAX,
                meta(model="leitstelle_olten", tenant="CARGOCONTROL", columns=PERSONS_COLS, person_key="person_sk"))
    write_query(base, "ac1", "notes", NOTES_DAX, meta(
        columns={"person_sk": "label_person", "beschreibung": "label_freetext", "dor_name": "label_org",
                 "start_location": "label_location"},
        person_key="person_sk", derived={"tn_count": "measure"}))
    write_query(base, "ac1", "params", PARAMS_DAX, meta(
        params={
            "person": {"type": "pseudonym", "filter_column": "'dim_person'[person_sk]"},
            "depot": {"type": "sk", "filter_column": "'dim_depot'[depot_sk]"},
            "audience": {"type": "enum", "values": ["ausbilder", "auszubildende"], "required": True},
            "hour": {"type": "int", "min": 0, "max": 23},
            "day": {"type": "date", "default": "today"},
            "month": {"type": "month"},
            "qual": {"type": "sk"},
        },
        columns={"n": "measure", "a": "code", "d": "date", "m": "date", "q": "id"}))
    write_query(base, "ac1", "window", WINDOW_DAX, meta(
        params={"dates": {"type": "date_window", "default_days": 30, "anchor": "to_today"}},
        columns={"n": "measure"}))
    write_query(base, "ac8", "rts_only", 'EVALUATE ROW ( "n", 1 )\n',
                meta(model="leitstelle_olten", tenant="CARGOCONTROL", columns={"n": "measure"}))
    write_query(base, "ac1", "data_as_of", 'EVALUATE ROW ( "n", 1 )\n', meta(columns={"n": "measure"}))
    return base
