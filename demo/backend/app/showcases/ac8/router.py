"""AC-8 showcase router, mounted under /api/ac8. Owned by the AC-8 session (demo/OWNERSHIP.md).

Leitstand Leitstelle Olten (sm_leitstelle_olten, CargoControl only): /ping plus the generic named-query
routes (/queries, /q/{name}) over queries/ac8/ - eleven queries, README there. No custom route: every view
reads a named query; there is no server-side transform and no Bronze read (the flow-map view was cut in
Step 2, see the README).
"""
from fastapi import APIRouter

from app.core.routing import add_query_routes

SHOWCASE = "ac8"
router = APIRouter()


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


add_query_routes(router, SHOWCASE)
