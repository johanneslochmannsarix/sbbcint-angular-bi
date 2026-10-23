"""AC-1 showcase router, mounted under /api/ac1. Owned by the AC-1 session (demo/OWNERSHIP.md).

Plantafel for the Ausbildungsabteilung (RT&S only): month calendar -> day Gantt -> person day plan, cohort
week grid and a map of where everyone is according to PLAN (never IST). Named queries in queries/ac1/
(README there maps them to the RDLs). Routes beyond the generic /queries and /q/{name}:

    GET /day_tags?env=&day=      ALP:/TN:/Prüfer: tags of that day, parsed server side (tags.py), masked
    GET /locations?env=          referenced location names -> lat/lon from Bronze (locations.py)
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core import queries as Q
from app.core.bronze import BronzeError, BronzeRefused
from app.core.dax_client import DaxError
from app.core.limiter import RateLimited
from app.core.routing import add_query_routes, core, error_response, single_params
from app.core.service import QueryNotFound

from . import locations, tags

SHOWCASE = "ac1"
router = APIRouter()
_ERRORS = (Q.ParamError, QueryNotFound, RateLimited, DaxError, BronzeError, BronzeRefused)

# joined coordinates per env, for the process lifetime (Bronze changes per batch at most)
_locations: dict[str, dict] = {}


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


@router.get("/q/day_tags")
async def raw_day_tags_refused():
    # the raw union carries the name candidates (masked, but pointless to ship); only the parsed form is served
    return JSONResponse({"error": "use /api/ac1/day_tags (parsed server side)"}, status_code=404)


@router.get("/day_tags")
async def day_tags(request: Request):
    try:
        raw, fresh = single_params(request)
        return await core(request).service.run(SHOWCASE, "day_tags", raw, fresh=fresh, transform=tags.tag_rows)
    except _ERRORS as e:
        return error_response(e)


@router.get("/locations")
async def locations_route(request: Request):
    try:
        raw, fresh = single_params(request)
        c = core(request)
        names = await c.service.run(SHOWCASE, "location_names", raw, fresh=fresh)
        env = names["env"]
        if fresh or env not in _locations:
            rows = await c.bronze.aread(f"RTS_{env}", locations.BRONZE_TABLE, locations.BRONZE_COLUMNS)
            joined = locations.join(names["rows"], rows)
            counts: dict[str, int] = {}
            for e in joined:
                counts[e["status"]] = counts.get(e["status"], 0) + 1
            _locations[env] = {
                "showcase": SHOWCASE, "env": env, "source": f"Bronze RTS_{env}.{locations.BRONZE_TABLE} (by name)",
                "locations": joined, "counts": counts,
                "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            }
        return _locations[env]
    except _ERRORS as e:
        return error_response(e)


add_query_routes(router, SHOWCASE)
