"""AC-6 showcase router, mounted under /api/ac6. Owned by the AC-6 session (demo/OWNERSHIP.md).

JUP Planung explorer (sm_fico, table fico_planung; CargoControl only): /ping plus the generic named-query routes
(/queries, /q/{name}) over queries/ac6/ - twelve queries, README there. No custom route and no server-side
transform: every label filter is a rank the DAX resolves to the name (the whitelist comes from the model via
`dims`), the tour drill filters by tour id (an sk, not a person).
"""
from fastapi import APIRouter

from app.core.routing import add_query_routes

SHOWCASE = "ac6"
router = APIRouter()


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


add_query_routes(router, SHOWCASE)
