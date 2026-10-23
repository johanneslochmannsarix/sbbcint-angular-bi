"""AC-9 showcase router, mounted under /api/ac9. Owned by the AC-9 session (demo/OWNERSHIP.md).

Rechnungslegung RT&S (sm_rechnungslegung_rts, RT&S only): /ping, /queries and /q/{name} over queries/ac9/ -
twelve queries, README there. The named-query route is this showcase's own (not add_query_routes) because two
params are resolved here before the core sees them:

    auftrag  the order token T-... (in every mode; under -Real dor_name shows the name, auftrag_token keeps the
             token) -> the order's ordinal in the model's sorted name list (ids.OrderOrdinals, filled by the
             auftrag_liste / auftraege transforms; a miss runs auftrag_liste once). A raw number or a name is
             refused: the browser never holds an ordinal, and no order name travels in a URL.
    tour     the tour pseudo-id D-... (ids.TourIds) -> doi_id. punkte / touren / tour_kopf return the pseudo-id
             in place of doi_id.

Everything else - whitelist, cache, limiter, role coverage, masking - is the core's QueryService.
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from app.core import datasets as D
from app.core import queries as Q
from app.core.dax_client import DaxError
from app.core.limiter import RateLimited
from app.core.masking import TEXT_TOKEN_RE
from app.core.routing import Core, core, error_response, single_params
from app.core.service import QueryNotFound

from .ids import Ac9State, order_capture_transform, tour_id_transform

SHOWCASE = "ac9"
router = APIRouter()

TOUR_ID_QUERIES = frozenset({"punkte", "touren", "tour_kopf"})
ORDER_CAPTURE_QUERIES = frozenset({"auftrag_liste", "auftraege"})
MAX_HANDLE = 200


def state(c: Core) -> Ac9State:
    st = c.extras.get(SHOWCASE)
    if st is None or st.masker is not c.masker:
        st = c.extras[SHOWCASE] = Ac9State(c.masker)
    return st


def _env(raw: dict[str, str]) -> str:
    env = raw.get("env")
    if env not in D.ENVS:
        raise Q.ParamError(f"env must be one of {', '.join(D.ENVS)}")
    return env


async def _resolve_order(c: Core, st: Ac9State, env: str, handle: str) -> int:
    if not handle or len(handle) > MAX_HANDLE or not TEXT_TOKEN_RE.match(handle):
        raise Q.ParamError("auftrag must be an order token T-… (auftrag_token of the order list)")
    nr = st.orders.get(env, handle)
    if nr is None:
        await c.service.run(SHOWCASE, "auftrag_liste", {"env": env}, transform=order_capture_transform(st, env))
        nr = st.orders.get(env, handle)
    if nr is None:
        raise Q.ParamError("auftrag: unknown order token for this environment "
                           "(tokens change when the backend restarts)")
    return nr


def _transform(st: Ac9State, name: str, env: str | None):
    if name in ORDER_CAPTURE_QUERIES and env in D.ENVS:
        return order_capture_transform(st, env)
    if name in TOUR_ID_QUERIES:
        return tour_id_transform(st)
    return None


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


@router.get("/queries")
async def list_queries(request: Request):
    out = core(request).service.describe(SHOWCASE)
    for q in out:
        for p in q["params"]:
            if p["name"] == "auftrag":
                p.update(type="order_token", note="T-… from auftrag_liste / auftraege; resolved server side")
                p.pop("min", None), p.pop("max", None)
            elif p["name"] == "tour":
                p.update(type="tour_pseudo_id", note="D-… from punkte / touren; resolved server side")
    return {"queries": out}


@router.get("/q/{name:path}")
async def run_query(name: str, request: Request):
    try:
        c = core(request)
        st = state(c)
        raw, fresh = single_params(request)
        env = raw.get("env")
        handles: dict[str, str] = {}                 # what the browser sent, echoed back instead of the resolved key
        if "auftrag" in raw:
            env = _env(raw)
            handles["auftrag"] = raw["auftrag"]
            raw["auftrag"] = str(await _resolve_order(c, st, env, raw["auftrag"]))
        if "tour" in raw:
            doi = st.tours.resolve(raw["tour"])
            if doi is None:
                raise Q.ParamError("tour must be a tour pseudo-id D-… from punkte / touren "
                                   "(pseudo-ids change when the backend restarts)")
            handles["tour"] = raw["tour"]
            raw["tour"] = doi
        if raw.get("von") and raw.get("bis") and raw["von"] > raw["bis"]:
            raise Q.ParamError("von must not be after bis")
        res = await c.service.run(SHOWCASE, name, raw, fresh=fresh, transform=_transform(st, name, env))
        # the payload echoes the validated params: never the ordinal or the doi_id (copies - the cache keeps its own)
        return {**res, "params": {**res["params"], **{k: v for k, v in handles.items() if k in res["params"]}}}
    except (Q.ParamError, QueryNotFound, RateLimited, DaxError, D.UnknownDataset) as e:
        return error_response(e)
