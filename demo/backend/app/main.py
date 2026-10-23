"""Demo app backend (local only). Read-only: executeQueries against the datasets in core/datasets.py, plus
the read-only Bronze reader for coordinates.

    uvicorn app.main:app --host 127.0.0.1 --port <8765 integrated | 8766 ac2 | 8767 ac1 | 8768 ac8 | 8772 ac4 (8769 = cockpit proxy) | 8770 ac10 | 8771 ac6 | 8773 ac7 | 8774 ac9 | 8775 ac13>

Env (set per process by run.ps1 / dev.ps1, never globally):
    DEMO_LIMIT_PER_MIN   executeQueries budget of this instance (core/limiter.py; default 35, max 110)
    DEMO_REAL=1          real person labels (run.ps1 -Real only); masked otherwise

Routers: /api/ac1, /api/ac2, /api/ac8, /api/metrics, /api/ac4, /api/ac10, /api/ac6, /api/ac7, /api/ac9, /api/ac13 from app/showcases/<ac>/router.py (owned by the showcase sessions),
/api/health here. Startup refuses to run when a query definition breaks the role contract
(core/queries.py) or names a forbidden column (core/forbidden.py).
"""
from __future__ import annotations

import datetime as dt
import importlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .core import datasets as D
from .core import forbidden
from .core import queries as Q
from .core.bronze import BronzeReader
from .core.cache import ResponseCache
from .core.dax_client import DaxClient
from .core.masking import Masker
from .core.routing import Core, core
from .core.service import QueryService

SHOWCASES = Q.SHOWCASES
CORS_ORIGINS = [f"http://localhost:{p}" for p in (4200, 4201, 4202, 4203, 4204, 4206, 4207, 4208, 4209)]

log = logging.getLogger("demo.api")


def create_app(client: DaxClient | None = None, registry: Q.Registry | None = None,
               cache: ResponseCache | None = None, masker: Masker | None = None,
               bronze: BronzeReader | None = None, today: Callable[[], dt.date] = dt.date.today,
               queries_dir: Path | None = None) -> FastAPI:
    qdir = queries_dir or Q.QUERIES_DIR
    # startup self-checks: forbidden columns first (names alone are enough to refuse), then the role contract
    forbidden.enforce(qdir)
    registry = registry if registry is not None else Q.load_queries(qdir)
    cache = cache if cache is not None else ResponseCache()          # an empty cache is falsy (__len__)
    masker = masker if masker is not None else Masker()
    state: dict = {"client": client}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if state["client"] is None:
            state["client"] = DaxClient()
        app.state.core = Core(
            service=QueryService(state["client"], registry, cache, masker, today),
            bronze=bronze if bronze is not None else BronzeReader(),
            started_at=dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        )
        n = {sc: len(qs) for sc, qs in registry.items()}
        log.info("backend up: queries %s, %d datasets, mode=%s, limit=%d/min", n, len(D.REGISTRY), masker.mode,
                 state["client"].limiter.per_minute)
        yield
        await state["client"].aclose()

    app = FastAPI(title="demo backend (local spike)", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET"], allow_headers=[])

    for sc in SHOWCASES:
        mod = importlib.import_module(f"app.showcases.{sc}.router")
        app.include_router(mod.router, prefix=f"/api/{sc}", tags=[sc])

    @app.get("/api/health")
    async def health(request: Request):
        c = core(request)
        dax = c.client
        exp = dax.tokens.expires_at
        return {
            "real": c.masker.real,
            "mode": c.masker.mode,
            "started_at": c.started_at,
            "limit_per_minute": dax.limiter.per_minute,
            "calls_last_minute": dax.limiter.calls_last_minute(),
            "calls_peak_per_minute": dax.limiter.peak_per_minute,
            "calls_total": dax.limiter.total,
            "token_expires_at": dt.datetime.fromtimestamp(exp).astimezone().isoformat(timespec="seconds") if exp else None,
            "token_expires_in_s": dax.tokens.seconds_left(),
            "cache_entries": len(c.cache),
            "pseudonyms": len(c.masker),
            "last_error": dax.last_error,
            "queries": {sc: len(qs) for sc, qs in registry.items()},
            "datasets": [{"key": d.key, "name": d.name, "confirmed": d.confirmed} for d in D.REGISTRY.values()],
            "bronze_reads": c.bronze.reads,
            "bronze_last_error": c.bronze.last_error,
        }

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
app = create_app()
