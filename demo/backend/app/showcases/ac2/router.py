"""AC-2 showcase router, mounted under /api/ac2 (migrated from tmp/metrics_app_spike/ac2 in D0).

Named queries live per tenant in queries/ac2/cc/ and queries/ac2/rts/ (CC and RT&S have their own logic,
never inferred from each other); /q/{name}?tenant=...&env=... picks the tenant's variant (core lookup).
"""
from fastapi import APIRouter

from app.core.routing import add_query_routes

SHOWCASE = "ac2"
router = APIRouter()


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


add_query_routes(router, SHOWCASE)
