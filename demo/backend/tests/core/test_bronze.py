"""Bronze reader (core/bronze.py): exact allowlist, refusal before any I/O, read-only, no values leaked."""
from __future__ import annotations

import asyncio
import inspect

import pytest

from app.core import bronze as B
from tests.support import FakeOpener, fake_bronze


@pytest.mark.parametrize("schema", [
    "LOCLOCATION", "loclocation", "LocLocation", "rts_prod", "RTS_PROD ", " RTS_PROD", "RTS_PROD/../LOCLOCATION",
    "RTS_PROD/public_location", "dbo", "", None, "CARGOCONTROL_DEV", "RTS", "CC_PROD",
])
def test_foreign_schemas_refused_before_io(schema):
    opener = FakeOpener()
    r = fake_bronze(opener)
    with pytest.raises(B.BronzeRefused):
        r.structure(schema, "public_location")
    with pytest.raises(B.BronzeRefused):
        r.read(schema, "public_abstractcustomlocation", ["latitude"])
    with pytest.raises(B.BronzeRefused):
        B.table_uri(schema, "public_location")
    assert opener.calls == []


@pytest.mark.parametrize("table", [
    "public_worker", "public_shift", "public_abstractcustomlocation_audit", "PUBLIC_LOCATION", "public_location;",
    "../public_location", "public_location/_delta_log", "", None,
])
def test_foreign_tables_refused_before_io(table):
    opener = FakeOpener()
    r = fake_bronze(opener)
    with pytest.raises(B.BronzeRefused):
        r.read("RTS_PROD", table, ["latitude"])
    assert opener.calls == []


@pytest.mark.parametrize("columns", [[], ["*"], ["Latitude"], ["latitude; drop"], ["a"] * 2, [f"c{i}" for i in range(13)]])
def test_columns_must_be_named_and_valid(columns):
    opener = FakeOpener()
    with pytest.raises(B.BronzeRefused):
        fake_bronze(opener).read("RTS_PROD", "public_location", columns)
    assert opener.calls == []


@pytest.mark.parametrize("col", ["street", "housenumber", "postalcode", "city", "description", "street2",
                                 "postalcode_ext", "zipcode", "addressline", "cityname"])
def test_address_columns_refused_before_io(col):
    """Johannes 2026-10-21: address columns are never selected, not even next to allowed ones, not even async."""
    opener = FakeOpener([{"id": 1, "name": "x", "latitude": "1", "longitude": "2", col: "y"}])
    r = fake_bronze(opener)
    with pytest.raises(B.BronzeRefused, match="address column"):
        r.read("RTS_PROD", "public_abstractcustomlocation", ["id", "name", col])
    with pytest.raises(B.BronzeRefused, match="address column"):
        asyncio.run(r.aread("RTS_QA", "public_location", [col]))
    assert opener.calls == [] and r.reads == 0


def test_location_columns_stay_readable():
    for col in ("id", "name", "latitude", "longitude"):
        assert not B.forbidden_column(col)


def test_column_not_in_table_refused():
    with pytest.raises(B.BronzeRefused, match="not in"):
        fake_bronze().read("RTS_PROD", "public_location", ["latitude", "secret"])


def test_uri_and_storage_options():
    opener = FakeOpener()
    r = fake_bronze(opener)
    s = r.structure("CARGOCONTROL_QA", "public_abstractcustomlocation")
    assert s == {"schema": "CARGOCONTROL_QA", "table": "public_abstractcustomlocation",
                 "columns": ["id", "name", "latitude", "longitude"], "row_count": 1}
    uri, opts = opener.calls[0]
    assert uri == ("abfss://d8edf207-6f90-438e-92b9-20b3f41caedf@onelake.dfs.fabric.microsoft.com/"
                   "67d36fc3-4702-4ac7-b9a1-71ea29d19c4c/Tables/CARGOCONTROL_QA/public_abstractcustomlocation")
    assert opts == {"bearer_token": "storage-tok", "use_fabric_endpoint": "true"}


def test_read_returns_only_named_columns_and_is_cached():
    opener = FakeOpener()
    r = fake_bronze(opener)
    rows = r.read("RTS_PROD", "public_location", ["latitude", "longitude"])
    assert rows == [{"latitude": "47.1", "longitude": "7.9"}]
    assert asyncio.run(r.aread("RTS_PROD", "public_location", ["latitude", "longitude"])) == rows
    assert len(opener.calls) == 1 and r.reads == 1


def test_open_failure_is_bronze_error_not_absent():
    def boom(uri, opts):
        raise OSError("403 Forbidden")
    r = B.BronzeReader(tokens=fake_bronze().tokens, opener=boom)
    with pytest.raises(B.BronzeError, match="unverified|failed"):
        r.structure("RTS_PROD", "public_location")
    assert r.last_error and "403" in r.last_error


def test_module_never_writes():
    src = inspect.getsource(B)
    assert "write_deltalake" not in src.replace("never imports write_deltalake", "")
    for verb in (".delete(", ".merge(", ".vacuum(", ".optimize", "mode=\"overwrite\"", ".update("):
        assert verb not in src
