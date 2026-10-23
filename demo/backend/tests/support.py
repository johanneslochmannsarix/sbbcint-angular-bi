"""Shared offline test helpers (no Fabric, no az): httpx.MockTransport stands in for executeQueries, a fake
opener for Bronze. Showcase tests may import these (`from tests.support import ...`); they are core-owned.
All person strings used with them are invented fixtures.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import httpx

from app.core.bronze import BronzeReader
from app.core.cache import ResponseCache
from app.core.dax_client import DaxClient, Token, TokenCache
from app.core.limiter import RateLimiter
from app.core.masking import Masker
from app.main import create_app

TODAY = dt.date(2026, 10, 20)


class Clock:
    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def ok_body(rows: list[dict]) -> dict:
    return {"results": [{"tables": [{"rows": rows}]}]}


class Upstream:
    """Scripted executeQueries: a list of (status, body) answered in order (last one repeats)."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body = self.answers[min(len(self.requests), len(self.answers)) - 1]
        text = body if isinstance(body, str) else json.dumps(body)
        return httpx.Response(status, text=text)

    def sent_query(self, i: int = -1) -> str:
        return json.loads(self.requests[i].content)["queries"][0]["query"]


def make_client(upstream: Upstream, clock: Clock | None = None, limiter: RateLimiter | None = None) -> DaxClient:
    clock = clock or Clock()
    n = {"i": 0}

    def fetch() -> Token:
        n["i"] += 1
        return Token(f"tok{n['i']}", clock() + 3600)

    return DaxClient(tokens=TokenCache(fetcher=fetch, clock=clock),
                     limiter=limiter or RateLimiter(per_minute=110, clock=clock),
                     transport=httpx.MockTransport(upstream))


class FakeField:
    def __init__(self, name: str):
        self.name = name


class FakeDeltaTable:
    """Stands in for deltalake.DeltaTable: schema().fields, count(), to_pyarrow_table(columns).to_pylist()."""

    def __init__(self, rows: list[dict]):
        self._rows = rows

    def schema(self):
        cols = list(self._rows[0]) if self._rows else []
        return type("S", (), {"fields": [FakeField(c) for c in cols]})()

    def count(self) -> int:
        return len(self._rows)

    def to_pyarrow_table(self, columns):
        rows = [{c: r[c] for c in columns} for r in self._rows]
        return type("T", (), {"to_pylist": lambda _self: rows})()


class FakeOpener:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = rows or [{"id": 1, "name": "Station A", "latitude": "47.1", "longitude": "7.9"}]
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, uri: str, opts: dict) -> FakeDeltaTable:
        self.calls.append((uri, opts))
        return FakeDeltaTable(self.rows)


def fake_bronze(opener: FakeOpener | None = None) -> BronzeReader:
    tokens = TokenCache(fetcher=lambda: Token("storage-tok", 4_000_000_000.0), clock=lambda: 0.0)
    return BronzeReader(tokens=tokens, opener=opener or FakeOpener())


def make_app(upstream: Upstream, *, cache_clock: Clock | None = None, limiter: RateLimiter | None = None,
             masker: Masker | None = None, registry=None, queries_dir: Path | None = None,
             bronze: BronzeReader | None = None):
    client = make_client(upstream, limiter=limiter)
    # `is None`, not `or`: an empty Masker is falsy (__len__)
    app = create_app(client=client, cache=ResponseCache(clock=cache_clock or Clock()),
                     masker=Masker(real=False) if masker is None else masker, registry=registry,
                     bronze=bronze or fake_bronze(),
                     today=lambda: TODAY, queries_dir=queries_dir)
    return app, client


def write_query(base: Path, showcase: str, qid: str, dax: str, roles: dict | str) -> Path:
    """Write queries/<showcase>/<qid>.dax + .roles.json under base; returns base (a queries dir)."""
    for sc in ("ac1", "ac2", "ac8", "metrics", "ac4"):
        (base / sc).mkdir(parents=True, exist_ok=True)
    p = base / showcase / f"{qid}.dax"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(dax, encoding="utf-8")
    text = roles if isinstance(roles, str) else json.dumps(roles)
    p.with_suffix(".roles.json").write_text(text, encoding="utf-8")
    return base


def meta(**kw) -> dict:
    """A minimal valid roles.json body; override / extend with keyword arguments."""
    base = {"model": "import", "tenant": "RTS", "replaces": "x", "view": "x", "grain": "x"}
    base.update(kw)
    return base
