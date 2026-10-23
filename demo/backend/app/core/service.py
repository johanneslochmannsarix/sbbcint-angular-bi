"""QueryService: the one path from a request to a masked, cached payload.

    lookup -> select dataset (tenant/env) -> validate params -> cache -> render -> executeQueries (guard)
    -> role coverage -> optional server-side transform -> masking -> cache put -> payload

Showcase routers call `run`. A transform (e.g. AC-1's ALP:/TN:/Prüfer: parser) sees the unmasked rows
inside the backend and must return rows whose every column is declared in the query's roles.json
(columns or derived); its output is masked like any other. Nothing unmasked is cached or returned.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Callable

from . import datasets as D
from . import queries as Q
from .cache import ResponseCache
from .dax_client import DaxClient, DaxError
from .masking import Masker

log = logging.getLogger("demo.service")

Transform = Callable[[list[dict], dict], list[dict]]


class RoleCoverageError(DaxError):
    """The model returned a column the query did not declare (or omitted a declared one) -> 502."""


class QueryNotFound(LookupError):
    """No such named query for this showcase / tenant -> 404."""


def check_coverage(q: Q.NamedQuery, columns: list[str], allowed: dict[str, str] | None = None,
                   stage: str = "result") -> None:
    allowed = q.columns if allowed is None else allowed
    returned = set(columns)
    unknown = returned - set(allowed)
    if unknown:
        raise RoleCoverageError(f"{q.showcase}/{q.qid}: undeclared column(s) {sorted(unknown)} in the {stage} - "
                                "refused, every returned column needs a declared role")
    if stage == "result" and columns and set(q.columns) - returned:
        raise RoleCoverageError(f"{q.showcase}/{q.qid}: declared column(s) {sorted(set(q.columns) - returned)} "
                                "missing from the result")


@dataclass
class QueryService:
    client: DaxClient
    registry: Q.Registry
    cache: ResponseCache
    masker: Masker
    today: Callable[[], dt.date] = dt.date.today

    def describe(self, showcase: str) -> list[dict]:
        return [q.describe() for _, q in sorted(self.registry.get(showcase, {}).items())]

    async def run(self, showcase: str, name: str, raw: dict[str, str], *, fresh: bool = False,
                  transform: Transform | None = None) -> dict:
        raw = dict(raw)
        q = Q.lookup(self.registry, showcase, name, raw.get("tenant"))
        if q is None and raw.get("tenant") not in Q.TENANT_DIR and any(
                f"{sub}/{name}" in self.registry.get(showcase, {}) for sub in Q.TENANT_DIR.values()):
            raise Q.ParamError(f"tenant must be one of {', '.join(Q.TENANT_DIR)}")   # a tenant variant exists
        if q is None:
            raise QueryNotFound(f"query {name!r} is not defined for {showcase}"
                                + (f" / {raw['tenant']}" if raw.get("tenant") in D.TENANTS else ""))
        sel = Q.select(q, raw)
        params = Q.validate(q, raw, sel, self.masker, today=self.today())
        tname = f"{transform.__module__}.{transform.__qualname__}" if transform else None
        key = Q.cache_key(q, sel, params, tname)
        if not fresh and (hit := self.cache.get(key)) is not None:
            return {**hit, "cached": True}
        async with self.cache.lock(key):
            if not fresh and (hit := self.cache.get(key)) is not None:
                return {**hit, "cached": True}
            dataset = D.lookup(q.model, sel.tenant, sel.env)
            res = await self.client.execute(dataset, Q.render(q, params, sel, self.masker))
            check_coverage(q, res.columns)
            rows, columns = res.rows, res.columns or list(q.columns)
            if transform is not None:
                rows = transform(rows, params)
                columns = list(dict.fromkeys(k for r in rows for k in r)) or list(q.roles)
                check_coverage(q, columns, q.roles, stage="transform output")
            rows = self.masker.mask_rows(rows, q.roles, sel.tenant, q.person_keys, q.label_of)
            payload = {
                "showcase": showcase,
                "name": q.name,
                "id": q.qid,
                "dataset": dataset.key,
                "tenant": sel.tenant,
                "env": sel.env,
                "params": {k: str(v) for k, v in params.items()},
                "columns": columns,
                "roles": {c: q.roles[c] for c in columns},
                "person_keys": [k for k in q.person_keys if k in columns],
                "mode": self.masker.mode,
                "rows": rows,
                "row_count": len(rows),
                "elapsed_ms": res.elapsed_ms,
                "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "warnings": res.warnings,
            }
            self.cache.put(key, payload)
            log.info("query %s/%s on %s rows=%d %d ms", showcase, q.qid, dataset.key, len(rows), res.elapsed_ms)
            return {**payload, "cached": False}
