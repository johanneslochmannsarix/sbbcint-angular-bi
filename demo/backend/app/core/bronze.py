"""Read-only Bronze Delta reader for location coordinates (AC-1 map, AC-8 flow map).

Scope, hard-coded and exact-match (anything else -> BronzeRefused, before any I/O):
- workspace ANALYTICS_CORE d8edf207-..., lakehouse Bronze 67d36fc3-... (CLAUDE.md topology)
- schemas RTS_PROD / RTS_QA / CARGOCONTROL_PROD / CARGOCONTROL_QA only. NEVER LOCLOCATION (a third-party
  tenant sharing the lakehouse, out of scope) and never any other schema
- tables public_abstractcustomlocation / public_location only
- columns named by the caller (no "all columns"), at most MAX_COLUMNS, each must exist in the table
- never an address column (Johannes 2026-10-21: street / housenumber / postalcode / city are never selected,
  not even in probes): any name in FORBIDDEN_COLUMNS or containing a FORBIDDEN_PARTS word is refused
- no writes: this module never imports write_deltalake and opens tables for reading only

Auth: deltalake (delta-rs, object_store Azure backend) with storage_options
{"bearer_token": <token>, "use_fabric_endpoint": "true"} - the pattern on
https://learn.microsoft.com/en-us/fabric/onelake/onelake-azure-databricks (serverless section) and the
object_store AzureConfigKey aliases `bearer_token` (Token) / `use_fabric_endpoint` (UseFabricEndpoint),
https://docs.rs/object_store/latest/object_store/azure/enum.AzureConfigKey.html. The token comes from
`az account get-access-token --resource https://storage.azure.com` like the repo's OneLake scripts; it
lives in this process only.

Values stay server side: `read` returns rows to showcase code, which must expose them only through
declared roles (coordinates of operational locations are not person data; PLAN §12.3 says ask Johannes
before showing person-related places). Bronze changes per batch at most, so reads are cached for the
process lifetime.
"""
from __future__ import annotations

import asyncio
import logging
import re
import threading
from typing import Any, Callable

from .dax_client import Token, TokenCache, az_token

log = logging.getLogger("demo.bronze")

WORKSPACE_ID = "d8edf207-6f90-438e-92b9-20b3f41caedf"      # WORKSPACE_ANALYTICS_CORE
LAKEHOUSE_ID = "67d36fc3-4702-4ac7-b9a1-71ea29d19c4c"      # dlh_bronze_euw_prod_analytics
STORAGE_RESOURCE = "https://storage.azure.com"
ALLOWED_SCHEMAS = ("RTS_PROD", "RTS_QA", "CARGOCONTROL_PROD", "CARGOCONTROL_QA")
ALLOWED_TABLES = ("public_abstractcustomlocation", "public_location")
MAX_COLUMNS = 12
_COL_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
# Address-like columns of public_abstractcustomlocation / public_location (D2 2026-10-21, core request ac1 #2).
# Extend, never shrink. The parts also catch variants such as street2, postalcode_ext, addressline.
FORBIDDEN_COLUMNS = frozenset({"street", "housenumber", "postalcode", "city", "description"})
FORBIDDEN_PARTS = ("street", "housenumber", "postal", "zip", "city", "address", "description")


def forbidden_column(name: str) -> bool:
    n = name.lower()
    return n in FORBIDDEN_COLUMNS or any(p in n for p in FORBIDDEN_PARTS)


class BronzeRefused(PermissionError):
    """Schema / table / column outside the allowlist -> refused before any I/O (HTTP 403)."""


class BronzeError(RuntimeError):
    """The read itself failed (auth, network, Delta) -> HTTP 502. A failure is `unverified`, never `absent`."""


def storage_token_fetcher() -> Token:
    return az_token(STORAGE_RESOURCE)


def _delta_open(uri: str, storage_options: dict[str, str]) -> Any:
    from deltalake import DeltaTable          # imported lazily: tests and DAX-only runs never load it
    return DeltaTable(uri, storage_options=storage_options)


def check_scope(schema: str, table: str) -> tuple[str, str]:
    """Exact match against the allowlists; returns the literals from the allowlists, never the input."""
    if not isinstance(schema, str) or schema not in ALLOWED_SCHEMAS:
        raise BronzeRefused(f"schema {schema!r} is outside the Bronze allowlist {list(ALLOWED_SCHEMAS)}")
    if not isinstance(table, str) or table not in ALLOWED_TABLES:
        raise BronzeRefused(f"table {table!r} is outside the Bronze allowlist {list(ALLOWED_TABLES)}")
    return ALLOWED_SCHEMAS[ALLOWED_SCHEMAS.index(schema)], ALLOWED_TABLES[ALLOWED_TABLES.index(table)]


def table_uri(schema: str, table: str) -> str:
    s, t = check_scope(schema, table)
    return f"abfss://{WORKSPACE_ID}@onelake.dfs.fabric.microsoft.com/{LAKEHOUSE_ID}/Tables/{s}/{t}"


class BronzeReader:
    def __init__(self, tokens: TokenCache | None = None,
                 opener: Callable[[str, dict[str, str]], Any] = _delta_open):
        self.tokens = tokens or TokenCache(fetcher=storage_token_fetcher)
        self._open = opener
        self._cache: dict[tuple, list[dict]] = {}
        self._lock = threading.Lock()
        self.reads = 0
        self.last_error: str | None = None

    def _table(self, schema: str, table: str) -> Any:
        uri = table_uri(schema, table)
        opts = {"bearer_token": self.tokens.get_sync(), "use_fabric_endpoint": "true"}
        try:
            return self._open(uri, opts)
        except Exception as e:                       # noqa: BLE001 - delta-rs raises several types
            self.last_error = f"{type(e).__name__}: {str(e)[:300]}"
            raise BronzeError(f"Bronze open {schema}.{table} failed: {self.last_error}") from e

    def structure(self, schema: str, table: str) -> dict:
        """Column names + row count (from the Delta log). No values."""
        dt = self._table(schema, table)
        try:
            cols = [f.name for f in dt.schema().fields]
            n = int(dt.count())
        except Exception as e:                       # noqa: BLE001
            self.last_error = f"{type(e).__name__}: {str(e)[:300]}"
            raise BronzeError(f"Bronze structure {schema}.{table} failed: {self.last_error}") from e
        return {"schema": schema, "table": table, "columns": cols, "row_count": n}

    def read(self, schema: str, table: str, columns: list[str]) -> list[dict]:
        """Rows of the named columns. Values stay server side (see module docstring)."""
        s, t = check_scope(schema, table)
        if not columns:
            raise BronzeRefused("name the columns to read; there is no 'all columns'")
        if len(columns) > MAX_COLUMNS or len(set(columns)) != len(columns):
            raise BronzeRefused(f"at most {MAX_COLUMNS} distinct columns per read")
        for c in columns:
            if not isinstance(c, str) or not _COL_RE.match(c):
                raise BronzeRefused(f"bad column name {c!r}")
            if forbidden_column(c):
                raise BronzeRefused(f"column {c!r} is an address column; never selected (Johannes 2026-10-21)")
        key = (s, t, tuple(columns))
        with self._lock:
            if key in self._cache:
                return self._cache[key]
        dt = self._table(s, t)
        try:
            present = {f.name for f in dt.schema().fields}
            missing = [c for c in columns if c not in present]
            if missing:
                raise BronzeRefused(f"column(s) {missing} not in {s}.{t}")
            rows = dt.to_pyarrow_table(columns=list(columns)).to_pylist()
        except BronzeRefused:
            raise
        except Exception as e:                       # noqa: BLE001
            self.last_error = f"{type(e).__name__}: {str(e)[:300]}"
            raise BronzeError(f"Bronze read {s}.{t} failed: {self.last_error}") from e
        with self._lock:
            self._cache[key] = rows
            self.reads += 1
        log.info("bronze read %s.%s columns=%d rows=%d", s, t, len(columns), len(rows))
        return rows

    async def astructure(self, schema: str, table: str) -> dict:
        check_scope(schema, table)
        return await asyncio.to_thread(self.structure, schema, table)

    async def aread(self, schema: str, table: str, columns: list[str]) -> list[dict]:
        check_scope(schema, table)
        return await asyncio.to_thread(self.read, schema, table, columns)
