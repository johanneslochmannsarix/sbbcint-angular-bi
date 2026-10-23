"""AC-13 showcase router, mounted under /api/ac13. Owned by the AC-13 session (demo/OWNERSHIP.md).

Nachbereitung SBB Cargo Deutschland (sm_nachbereitung_cd, CargoControl, CC QA only until the PROD model exists):
/ping plus the generic named-query routes (/queries, /q/{name}) over queries/ac13/ - thirteen queries, README
there. No custom route and no server-side transform: label filters are ranks the DAX resolves (whitelist from
`dims`), the person filter is a pseudonym the core resolves to the hidden AC-13 key, the tour drill an sk.
"""
from fastapi import APIRouter

from app.core.routing import add_query_routes

SHOWCASE = "ac13"
router = APIRouter()


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


add_query_routes(router, SHOWCASE)
