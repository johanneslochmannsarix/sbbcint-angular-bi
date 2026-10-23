"""Live smoke for the core (D0): one EVALUATE ROW(COUNTROWS(<fact table>)) per registered dataset, and one
Bronze structure read. Prints ONLY status, the count, column names and timings - never a row.

    uv run --project demo\\backend --directory demo\\backend python smoke.py [dax] [bronze]
"""
from __future__ import annotations

import asyncio
import logging
import sys
import time

from app.core import datasets as D
from app.core.bronze import BronzeReader
from app.core.dax_client import DaxClient, DaxError
from app.core.limiter import RateLimiter

log = logging.getLogger("smoke")

FACT = {
    "import/CARGOCONTROL": "fact_person_qualification_latest",
    "import/RTS": "fact_person_tour_day",
    "leitstelle_olten/CARGOCONTROL": "fact_shift",
    "platform_metrics": "fact_pipeline_run",
}


async def dax() -> int:
    client = DaxClient(limiter=RateLimiter(per_minute=10))
    bad = 0
    try:
        for d in D.REGISTRY.values():
            table = FACT["/".join(x for x in (d.model, d.tenant) if x)]
            t0 = time.perf_counter()
            try:
                res = await client.execute(d, f'EVALUATE ROW ( "n", COUNTROWS ( \'{table}\' ) )')
                log.info("%-34s %-26s status=200 count(%s)=%s %d ms", d.key, d.name, table, res.rows[0]["n"],
                         int((time.perf_counter() - t0) * 1000))
            except DaxError as e:
                bad += 1
                log.info("%-34s %-26s status=%s error=%s", d.key, d.name, e.upstream_status, e.message[:200])
    finally:
        await client.aclose()
    return bad


def bronze() -> int:
    t0 = time.perf_counter()
    s = BronzeReader().structure("RTS_PROD", "public_abstractcustomlocation")
    log.info("bronze RTS_PROD.public_abstractcustomlocation row_count=%d columns(%d)=%s %d ms", s["row_count"],
             len(s["columns"]), ",".join(s["columns"]), int((time.perf_counter() - t0) * 1000))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    for noisy in ("httpx", "demo.dax"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    what = sys.argv[1:] or ["dax", "bronze"]
    rc = 0
    if "dax" in what:
        rc |= asyncio.run(dax())
    if "bronze" in what:
        rc |= bronze()
    sys.exit(1 if rc else 0)
