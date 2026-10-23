"""AC-4 showcase router, mounted under /api/ac4. Owned by the AC-4 session (demo/OWNERSHIP.md).

FiCo Produktivität CargoControl (sm_fico, CargoControl only): /ping plus the generic named-query routes
(/queries, /q/{name}) over queries/ac4/ - README there. No custom route and no server-side transform: every
view reads a named query, the tour drill-down filters by tour id (an sk, not a person) server side.
"""
from fastapi import APIRouter

from app.core.routing import add_query_routes

SHOWCASE = "ac4"
router = APIRouter()


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


add_query_routes(router, SHOWCASE)
