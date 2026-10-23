# Core requests — AC-4 (2026-10-21)

LOCAL-ONLY. The AC-4 session ran alone and made the narrow core additions the handover allowed itself
(each listed under «Done»). Everything else is a request here, solved locally in `features/ac4/`.

## Done by the AC-4 session (handover-sanctioned, with core tests)

- `backend/app/core/datasets.py`: model `fico` (sm_fico), CARGOCONTROL × PROD / QA; ids checked against
  `docs/reference/workspace-inventory.md` and the generator's `sm_id`. Test: `test_registry_ids_and_lookup`.
- `backend/app/core/queries.py`: `"ac4"` in `SHOWCASES` (that is what mounts `/api/ac4` in `main.py`);
  `main.py` CORS adds `http://localhost:4204`. Tests: `test_showcase_pings`, `test_cors_localhost_4200_to_4204_only`,
  `test_real_query_tree_loads`; `tests/support.py` creates `queries/ac4/` in temp trees.
- `dev.ps1`: `-Showcase ac4` → backend 8772 (moved from 8769, the cockpit proxy, 2026-10-21), ng serve 4204, `app/proxy.4204.json`.
- `app.routes.ts` lazy route `/ac4`, `app.html` nav tab, start-page tile (question, «jüngstes Ist» as data-as-of,
  scope).

## Requests

1. **`'ac4'` in the `Showcase` union** (`app/src/app/core/api.ts`). Today `features/ac4/data/store.ts` and the
   start tile cast `'ac4' as Showcase`. Fold: add `'ac4'` to the union and drop both casts.
2. **Dataset-count asserts** (`tests/core/test_app.py` `len(h["datasets"]) == …`,
   `tests/core/test_guard_cache_limiter.py` `len(D.REGISTRY) == …`): every new model breaks them (AC-4 moved them
   7 → 9; the parallel AC-10 session's two `offene_schichten` datasets now make them 11 vs 9 → the only two red
   offline tests at the end of this session). Suggest asserting the set of keys per model instead of a count.
3. **universalTransition treemap → bar** does not work in echarts 6.1.0 here: with one series id or with one id
   per shape paired by `seriesKey` (the AC-8 recipe, `[mergeOptions]`), the treemap leaves stay stuck on the
   canvas. AC-4 switches without the morph. If D2 wants the morph in the story, sunburst ↔ bar would need its
   own spike first.
4. **A typed `label` param** (non-ASCII names) would remove AC-4's rank trick for Personaltyp Tour (`ptyp` = the
   name's rank in the sorted column, resolved server side) — the enum whitelist refuses umlauts. The rank is
   deterministic per model state; only a refresh between `dims` and a filtered query could shift it (the UI
   shows the resolved name from `dims`).

- 2026-10-22: the Showcase-union request (#1) is done in core/api.ts; the local cast is removed.

