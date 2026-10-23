"""Metrics showcase router, mounted under /api/metrics (option B, 2026-10-21: the three pages of the original
metrics spike moved into the demo).

Named queries in queries/metrics/ (23, DAX unchanged from tmp/metrics_app_spike/backend/queries/, see the
README there): one dataset, sm_platform_metrics (core/datasets.py). env / tenant are not dataset selectors
here but typed `dim_env` filters (TREATAS, or ALL when an optional one is absent = an empty report slicer).
No person data: every column is an id, code, date, measure or label_technical.
"""
from fastapi import APIRouter

from app.core.routing import add_query_routes

SHOWCASE = "metrics"
router = APIRouter()


@router.get("/ping")
async def ping():
    return {"showcase": SHOWCASE, "ok": True}


add_query_routes(router, SHOWCASE)
