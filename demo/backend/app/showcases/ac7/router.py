"""AC-7 showcase router, mounted under /api/ac7. Owned by the AC-7 session (demo/OWNERSHIP.md).

Verleihliste RT&S (sm_au_verleihliste, RT&S only): named queries in queries/ac7/ (README there: views, filters, the
BA form map, Step 2 numbers). Routes beyond the generic /queries and /q/{name}:

    GET /v/{name}?env=&status=&ga=&taet=&ort=&auftrag=T-…&person=P-…&jahr=
                                  the filtered views (liste, kpi, fluss, arbeitszeit, orte); `auftrag` is an
                                  order-name TOKEN, resolved here to its rank (`auftrag_nr`) via `auftraege`
    GET /auftraege?env=           the order names with their token in every mode (transform: auftrag_token)
    GET /locations?env=           stint locations -> lat/lon on AC-1's coordinate route (Bronze
                                  public_abstractcustomlocation by name; address-like names withheld)

Read-only: no route writes anything, nothing here accepts a free value that reaches DAX (tokens / pseudonyms are
resolved server side, everything else is the core whitelist). /q/auftraege is refused (the token column only
exists on /auftraege), /q/<view> stays open for probes but takes `auftrag_nr`, never a name.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core import queries as Q
from app.core.bronze import BronzeError, BronzeRefused
from app.core.dax_client import DaxError
from app.core.limiter import RateLimited
from app.core.masking import TEXT_TOKEN_RE, Masker
from app.core.routing import add_query_routes, core, error_response, single_params
from app.core.service import QueryNotFound
# core request ac7 #2: AC-1's name classifier + Bronze join, reused unchanged (read-only import, no edit)
from app.showcases.ac1 import locations

SHOWCASE = "ac7"
VIEWS = ("liste", "kpi", "fluss", "arbeitszeit", "orte")
router = APIRouter()
_ERRORS = (Q.ParamError, QueryNotFound, RateLimited, DaxError, BronzeError, BronzeRefused)

# joined coordinates per env, for the process lifetime (Bronze changes per batch at most)
_locations: dict[str, dict] = {}


def token_transform(masker: Masker):
    """auftraege rows -> + auftrag_token (the T-… token of the raw order name, in every mode). Runs server side on
    the unmasked rows; the core masks `auftrag` afterwards. One function per masker (= per process), so the cache
    key (module + qualname) stays the same and the tokens are those of this process."""
    def add_auftrag_token(rows: list[dict], _params: dict) -> list[dict]:
        out = []
        for r in rows:
            a = r.get("auftrag")
            out.append({**r, "auftrag_token": masker.text_token(str(a)) if a not in (None, "") else None})
        return out
    return add_auftrag_token


async def _auftraege(request: Request, raw: dict[str, str], fresh: bool = False) -> dict:
    c = core(request)
    return await c.service.run(SHOWCASE, "auftraege", raw, fresh=fresh, transform=token_transform(c.masker))


async def resolve_auftrag(request: Request, env: str | None, token: str) -> int:
    if not TEXT_TOKEN_RE.match(token):
        raise Q.ParamError("auftrag must be an order-name token T-xxxxxx")
    res = await _auftraege(request, {"env": env} if env is not None else {})
    for r in res["rows"]:
        if r.get("auftrag_token") == token and r.get("rang") is not None:
            return int(r["rang"])
    raise Q.ParamError("auftrag: unknown token for this env (tokens change when the backend restarts)")


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


@router.get("/q/auftraege")
async def raw_auftraege_refused():
    return JSONResponse({"error": "use /api/ac7/auftraege (adds the order-name token)"}, status_code=404)


@router.get("/auftraege")
async def auftraege(request: Request):
    try:
        raw, fresh = single_params(request)
        return await _auftraege(request, raw, fresh)
    except _ERRORS as e:
        return error_response(e)


@router.get("/v/{name}")
async def view(name: str, request: Request):
    try:
        if name not in VIEWS:
            raise QueryNotFound(f"no filtered view {name!r} for {SHOWCASE}")
        raw, fresh = single_params(request)
        if "auftrag_nr" in raw:
            raise Q.ParamError("filter by auftrag=T-… (the token); auftrag_nr is resolved here")
        token = raw.pop("auftrag", None)
        if token is not None:
            raw["auftrag_nr"] = str(await resolve_auftrag(request, raw.get("env"), token))
        res = await core(request).service.run(SHOWCASE, name, raw, fresh=fresh)
        if token is not None:                   # echo the token, never the rank's name
            res = {**res, "params": {**{k: v for k, v in res["params"].items() if k != "auftrag_nr"}, "auftrag": token}}
        return res
    except _ERRORS as e:
        return error_response(e)


@router.get("/locations")
async def locations_route(request: Request):
    try:
        raw, fresh = single_params(request)
        c = core(request)
        names = await c.service.run(SHOWCASE, "orte", raw, fresh=fresh)
        env = names["env"]
        if fresh or env not in _locations:
            rows = await c.bronze.aread(f"RTS_{env}", locations.BRONZE_TABLE, locations.BRONZE_COLUMNS)
            joined = locations.join([{"location": r.get("ort"), "rows": r.get("personen")} for r in names["rows"]], rows)
            counts: dict[str, int] = {}
            for e in joined:
                counts[e["status"]] = counts.get(e["status"], 0) + 1
            _locations[env] = {
                "showcase": SHOWCASE, "env": env, "source": f"Bronze RTS_{env}.{locations.BRONZE_TABLE} (by name, AC-1 route)",
                "locations": [{k: e[k] for k in ("id", "name", "lat", "lon", "kind", "status")} for e in joined],
                "counts": counts,
                "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            }
        return _locations[env]
    except _ERRORS as e:
        return error_response(e)


add_query_routes(router, SHOWCASE)
