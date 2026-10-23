"""Shared route helpers for the showcase routers (app/showcases/<ac>/router.py).

    from app.core.routing import add_query_routes, core, error_response
    router = APIRouter()
    add_query_routes(router, "ac1")      # GET /queries, GET /q/{name}  (mounted under /api/ac1)

Custom routes reach the services through `core(request)` and turn core exceptions into HTTP answers with
`error_response(exc)`: ParamError 400, UnknownDataset 400 (no model in that env), QueryNotFound 404, RateLimited 429 (Retry-After), DaxError /
RoleCoverageError / BronzeError 502, BronzeRefused 403.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import datasets as D
from . import queries as Q
from .bronze import BronzeError, BronzeReader, BronzeRefused
from .cache import ResponseCache
from .dax_client import DaxClient, DaxError
from .limiter import RateLimited
from .masking import Masker
from .service import QueryNotFound, QueryService


@dataclass
class Core:
    service: QueryService
    bronze: BronzeReader
    started_at: str
    extras: dict = field(default_factory=dict)

    @property
    def client(self) -> DaxClient:
        return self.service.client

    @property
    def masker(self) -> Masker:
        return self.service.masker

    @property
    def cache(self) -> ResponseCache:
        return self.service.cache


def core(request: Request) -> Core:
    return request.app.state.core


def error_response(exc: Exception) -> JSONResponse:
    if isinstance(exc, Q.ParamError):
        return JSONResponse({"error": str(exc)}, status_code=400)
    if isinstance(exc, D.UnknownDataset):          # e.g. env=PROD while a model exists in QA only (core-requests-ac13 #1)
        return JSONResponse({"error": str(exc).strip("'")}, status_code=400)
    if isinstance(exc, QueryNotFound):
        return JSONResponse({"error": str(exc)}, status_code=404)
    if isinstance(exc, RateLimited):
        return JSONResponse({"error": str(exc)}, status_code=429,
                            headers={"Retry-After": str(max(1, int(exc.retry_after_s + 0.999)))})
    if isinstance(exc, BronzeRefused):
        return JSONResponse({"error": str(exc)}, status_code=403)
    if isinstance(exc, DaxError):
        return JSONResponse({"error": exc.message, "upstream_status": exc.upstream_status}, status_code=502)
    if isinstance(exc, BronzeError):
        return JSONResponse({"error": str(exc)}, status_code=502)
    raise exc


def single_params(request: Request) -> tuple[dict[str, str], bool]:
    """Query string -> dict; a key given twice or a bad `fresh` raises ParamError."""
    raw: dict[str, str] = {}
    for k, v in request.query_params.multi_items():
        if k in raw:
            raise Q.ParamError(f"parameter {k} given more than once")
        raw[k] = v
    fresh = raw.pop("fresh", None)
    if fresh not in (None, "0", "1"):
        raise Q.ParamError("fresh must be 0 or 1")
    return raw, fresh == "1"


def add_query_routes(router: APIRouter, showcase: str) -> None:
    @router.get("/queries")
    async def list_queries(request: Request):
        return {"queries": core(request).service.describe(showcase)}

    @router.get("/q/{name:path}")
    async def run_query(name: str, request: Request):
        try:
            raw, fresh = single_params(request)
            return await core(request).service.run(showcase, name, raw, fresh=fresh)
        except (Q.ParamError, QueryNotFound, RateLimited, DaxError, D.UnknownDataset) as e:
            return error_response(e)
