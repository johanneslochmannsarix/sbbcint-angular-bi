"""AC-10 showcase router, mounted under /api/ac10. Owned by the AC-10 session (demo/OWNERSHIP.md).

Offene Schichten CargoControl (sm_offene_schichten, CargoControl only): /ping plus the generic named-query
routes (/queries, /q/{name}) over queries/ac10/ - ten queries, README there. No custom route and no
server-side transform: every view reads a named query; Mandant / Depot / Haupttyp / category filters travel
as ordinals that the DAX resolves against the model's own value lists (README "Filters and params").
"""
from fastapi import APIRouter

from app.core.routing import add_query_routes

SHOWCASE = "ac10"
router = APIRouter()


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


add_query_routes(router, SHOWCASE)
