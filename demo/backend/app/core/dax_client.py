"""executeQueries client: az token cache, 401 refetch, limiter, response guard.

Doc: https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/execute-queries
- one query, one result table per call; 100 000 rows / 1 000 000 values / 15 MB per query
- 120 queries / minute / user across all datasets, shared with every pim session -> limiter.py
- truncation arrives as HTTP 200 + an error object -> checked on every 200 (status code != contract)
- includeNulls defaults to false -> always sent as true, else BLANK columns vanish from rows

Generalised from the AC-2 backend (tmp/metrics_app_spike/ac2/backend/app/dax_client.py, itself a copy of the
metrics backend): the dataset comes from datasets.py, the limiter from limiter.py, error messages are
scrubbed of data literals (scrub_message), and TokenCache serves any az resource (Bronze uses storage).
"""
from __future__ import annotations

import asyncio
import collections
import datetime as dt
import json
import logging
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Callable

import httpx

from .datasets import Dataset
from .limiter import RateLimiter

PBI_RESOURCE = "https://analysis.windows.net/powerbi/api"
REFRESH_MARGIN_S = 300        # refetch a token >= 5 min before it expires
ROW_WARN = 50_000

log = logging.getLogger("demo.dax")


class DaxError(Exception):
    """Upstream failed or answered with an error object -> HTTP 502 (scrubbed message passed through)."""

    def __init__(self, message: str, upstream_status: int | None = None):
        super().__init__(message)
        self.message = message
        self.upstream_status = upstream_status


# --------------------------------------------------------------------------- token

@dataclass
class Token:
    value: str
    expires_at: float          # epoch seconds


def az_token(resource: str) -> Token:
    """az account get-access-token for `resource`. The token never leaves this process."""
    az = shutil.which("az") or shutil.which("az.cmd")
    if not az:
        raise DaxError("az CLI not found on PATH")
    proc = subprocess.run([az, "account", "get-access-token", "--resource", resource, "-o", "json"],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        # az's stderr carries no secret; keep it short
        raise DaxError(f"az get-access-token failed (rc {proc.returncode}): {proc.stderr.strip()[:300]}")
    data = json.loads(proc.stdout)
    if "expires_on" in data:                      # epoch, az >= 2.54
        exp = float(data["expires_on"])
    else:                                         # 'expiresOn' is local time without zone
        exp = dt.datetime.strptime(data["expiresOn"][:19], "%Y-%m-%d %H:%M:%S").timestamp()
    return Token(data["accessToken"], exp)


def az_token_fetcher() -> Token:
    return az_token(PBI_RESOURCE)


class TokenCache:
    """Async token cache (executeQueries). `get_sync` serves threads (the Bronze reader runs in one)."""

    def __init__(self, fetcher: Callable[[], Token] = az_token_fetcher, clock: Callable[[], float] = time.time):
        self._fetch = fetcher
        self._clock = clock
        self._token: Token | None = None
        self._lock = asyncio.Lock()
        self._tlock = threading.Lock()
        self.fetches = 0

    @property
    def expires_at(self) -> float | None:
        return self._token.expires_at if self._token else None

    def seconds_left(self) -> int | None:
        return int(self._token.expires_at - self._clock()) if self._token else None

    def _fresh_enough(self) -> bool:
        return self._token is not None and self._clock() < self._token.expires_at - REFRESH_MARGIN_S

    def _refresh(self) -> None:
        self._token = self._fetch()
        self.fetches += 1
        log.info("token fetched, expires %s",
                 dt.datetime.fromtimestamp(self._token.expires_at).isoformat(timespec="seconds"))

    async def get(self, force: bool = False) -> str:
        async with self._lock:
            if force or not self._fresh_enough():
                await asyncio.to_thread(self._refresh_locked)
            return self._token.value

    def _refresh_locked(self) -> None:
        with self._tlock:
            self._refresh()

    def get_sync(self, force: bool = False) -> str:
        with self._tlock:
            if force or not self._fresh_enough():
                self._refresh()
            return self._token.value


# --------------------------------------------------------------------------- response handling

_KEY_RE = re.compile(r"^(?:'?(?P<table>[^'\[]*)'?)?\[(?P<col>[^\]]+)\]$")


def _snake(s: str) -> str:
    return re.sub(r"[^0-9a-zA-Z]+", "_", s).strip("_").lower()


def normalise_keys(keys: list[str]) -> dict[str, str]:
    """Table[Col] / 'Table'[Col] / [Measure] -> col / measure. On a clash: table_col."""
    parsed = []
    for k in keys:
        m = _KEY_RE.match(k)
        table, col = (m.group("table") or "", m.group("col")) if m else ("", k)
        parsed.append((k, _snake(table), _snake(col)))
    counts = collections.Counter(c for _, _, c in parsed)
    out = {}
    for k, table, col in parsed:
        out[k] = f"{table}_{col}" if counts[col] > 1 and table else col
    if len(set(out.values())) != len(out):
        raise DaxError(f"column names collide after normalisation: {sorted(out.values())}")
    return out


def _messages(obj) -> list[str]:
    """Collect human-readable strings from a Power BI error object (shape varies by error)."""
    found: list[str] = []

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ("message", "value") and isinstance(v, str):
                    found.append(v)
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(obj)
    if not found and obj:
        found.append(json.dumps(obj)[:500])
    return found


_QUOTED_RE = re.compile(r"'([^']*)'|\"([^\"]*)\"")


def scrub_message(msg: str, query: str | None) -> str:
    """A DAX error can quote a data value ("Cannot convert value 'X' of type Text ..."). Keep a quoted
    string only if it occurs in the DAX we sent (a table/column/literal of ours); redact the rest."""
    def repl(m: re.Match) -> str:
        inner = m.group(1) if m.group(1) is not None else m.group(2)
        if inner == "" or (query is not None and inner in query):
            return m.group(0)
        return "'<redacted>'"
    return _QUOTED_RE.sub(repl, msg)


@dataclass
class DaxResult:
    columns: list[str]
    rows: list[dict]
    elapsed_ms: int
    warnings: list[str]


def parse_response(status: int, text: str, query: str | None = None) -> tuple[list[str], list[dict]]:
    """Guard + normalise. Raises DaxError for any non-200 and for any error object on a 200."""
    try:
        body = json.loads(text) if text else {}
    except json.JSONDecodeError:
        body = None

    def fail(prefix: str, err) -> DaxError:
        return DaxError(prefix + scrub_message("; ".join(_messages(err)), query), status)

    if status != 200:
        if isinstance(body, dict):
            raise fail(f"executeQueries HTTP {status}: ", body.get("error", body))
        raise DaxError(f"executeQueries HTTP {status}: non-JSON body ({len(text or '')} bytes)", status)
    if not isinstance(body, dict):
        raise DaxError("executeQueries HTTP 200 with a non-JSON body", status)
    if body.get("error"):
        raise fail("HTTP 200 with top-level error: ", body["error"])
    results = body.get("results") or []
    if not results:
        raise DaxError("HTTP 200 without results", status)
    r0 = results[0]
    if r0.get("error"):
        raise fail("HTTP 200 with results[0].error: ", r0["error"])
    tables = r0.get("tables") or []
    if not tables:
        raise DaxError("HTTP 200 without tables", status)
    t0 = tables[0]
    if t0.get("error"):
        raise fail("HTTP 200 with tables[0].error (truncated?): ", t0["error"])
    raw_rows = t0.get("rows") or []
    keys: list[str] = []
    for row in raw_rows:                       # with includeNulls every row has every key; be defensive
        for k in row:
            if k not in keys:
                keys.append(k)
    mapping = normalise_keys(keys)
    rows = [{mapping[k]: row.get(k) for k in keys} for row in raw_rows]
    return [mapping[k] for k in keys], rows


class DaxClient:
    def __init__(self, tokens: TokenCache | None = None, limiter: RateLimiter | None = None,
                 transport: httpx.AsyncBaseTransport | None = None, timeout_s: float = 180.0):
        self.tokens = tokens or TokenCache()
        self.limiter = limiter or RateLimiter()
        self._http = httpx.AsyncClient(transport=transport, timeout=timeout_s)
        self.last_error: str | None = None

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _post(self, url: str, query: str, token: str) -> httpx.Response:
        self.limiter.acquire()
        payload = {"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}}
        try:
            return await self._http.post(url, json=payload, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as e:
            raise DaxError(f"executeQueries transport error: {type(e).__name__}") from e

    async def execute(self, dataset: Dataset, query: str) -> DaxResult:
        t0 = time.perf_counter()
        resp = await self._post(dataset.url, query, await self.tokens.get())
        if resp.status_code == 401:
            log.warning("executeQueries 401 - refetching the token once")
            resp = await self._post(dataset.url, query, await self.tokens.get(force=True))
        try:
            columns, rows = parse_response(resp.status_code, resp.text, query)
        except DaxError as e:
            self.last_error = e.message
            raise
        elapsed = int((time.perf_counter() - t0) * 1000)
        warnings = []
        if len(rows) > ROW_WARN:
            warnings.append(f"{len(rows)} rows > {ROW_WARN}: query a coarser grain")
            log.warning("executeQueries returned %d rows (> %d)", len(rows), ROW_WARN)
        return DaxResult(columns, rows, elapsed, warnings)
