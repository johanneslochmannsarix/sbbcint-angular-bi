# Core requests from AC-10 (PLAN §14.3)

Written by the AC-10 session only. Status 2026-10-21: done (Steps 1–6). Shared files touched, additive lines only:
`app.routes.ts` (lazy route), `app.html` (nav tab), `start/start-page.ts` (tile + `stand` query), `dev.ps1` (ac10 slot
8770 / 4205), new `app/proxy.4205.json`, `OWNERSHIP.md` (row), `README.md` (AC-10 lines), plus row 3 below.

| # | Date | Core area (file) | Request | Local workaround (where) | D2 status |
|---|------|------------------|---------|--------------------------|-----------|
| 1 | 2026-10-21 | `backend/app/core/queries.py` param types | A `label` param type validated against the model's own value set (e.g. `VALUES(dim_scope[depot_name])`, cached) and rendered as an escaped DAX string. Mandant / Depot / Haupttyp labels such as «(unbekannt)» or «CINT (CH) - Olten» do not fit the `enum` pattern, and an `sk` would expose `tenant_sk` (R7). | Ordinals: `int` params resolved in DAX by `1 + COUNTROWS(FILTER(ALL(col), col < EARLIER(col)))`; `scope` hands them out; `fenster` echoes the resolved labels so a refresh mismatch is visible (`queries/ac10/README.md`) | open |
| 2 | 2026-10-21 | `app/src/app/core/api.ts` `Showcase` | add `'ac10'` to the union | `queryFactory('ac10' as Showcase)` in `features/ac10/data/store.ts` | open |
| 3 | 2026-10-21 | shared registration (done, additive) | `datasets.py` model `offene_schichten` (PROD/QA ids checked vs inventory, both definition.pbir, generator); `queries.py` SHOWCASES + docstring; `main.py` docstring; core tests that pin the showcase set / dataset count (`test_definitions.py` set, `test_guard_cache_limiter.py` 11 + AC-10 asserts, `test_app.py` 11). CORS untouched: ng serve proxies /api, so 4205 needs no CORS entry | – | done by AC-10 |
| 5 | 2026-10-21 | `app/src/app/story/story.ts` (Johannes' go: story step, additive) | AC-10 story step 4 added after the AC-8 thread (host `ac10`, `Ac10Store.storyFocus`). One non-additive line: `enter()` tested `router.url.startsWith('/ac1')`, which is also true on `/ac10…`, so the AC-1 step after it never navigated (45 s timeout). Now a whole-segment match. The header comment «AC-4 steps 9-11» is stale (now 10-12); left as is. | – | done by AC-10 |
| 4 | 2026-10-21 | `app/src/app/shared/chart-opts.ts` | A hatch as a zrender pattern fill for `custom`-series graphics: their `style` ignores echarts `decal`, so `ariaDecal` / per-item decals don't reach a Gantt or heatmap drawn with `renderItem`. | `hatchFill(bg, line)` (cached 6 px canvas pattern) in `features/ac10/data/palette.ts`, used by the Tagesdrill | open |

- 2026-10-22: the Showcase-union request (#2) is done in core/api.ts; the local cast is removed.

