# Core requests from the AC-13 session (D1, 2026-10-21)

Solved locally inside the AC-13 folders; D2 decides whether to fold them into the core.

1. **An env without a registered dataset answers HTTP 500, not 400.** `service.run` calls `D.lookup`, whose
   `UnknownDataset` is not mapped by `routing.error_response`; `/api/ac13/q/<name>?env=PROD` (no PROD model yet)
   therefore raises. Nothing reaches Fabric. Proposal: map `UnknownDataset` to 400 «no dataset for <model>/<env>»
   (or validate env against `D.REGISTRY` in `queries.select`). Locally: the AC-13 page offers QA only and reads
   the available envs from its own constant until PROD is registered; test
   `test_prod_is_refused_before_any_call_while_the_model_is_qa_only`.
2. **`tests/core::test_registry_ids_and_lookup` requires `confirmed.startswith("inventory")`.** sm_nachbereitung_cd
   (QA, d94ec3d0) was created at 17:08 and `docs/reference/workspace-inventory.md` has not been regenerated since
   (no match for the id). The id is confirmed by a live read-only `list_items`, the QA mirror's definition.pbir and
   the report generator's `sm_id`. The entry's text therefore reads «inventory pending (not regenerated since
   17:08); live list_items + …» — true, and it keeps the core test green without editing `tests/core`. Proposal:
   allow «live list_items» as a confirmation source, or re-word once the inventory is regenerated (not ours: a
   tracked platform doc).
3. **`Showcase` union in `app/src/app/core/api.ts` lacks `ac13`** (as for ac4/ac6/ac7/ac9). Locally:
   `queryFactory('ac13' as Showcase)` in `features/ac13/data/store.ts` and the start tile.

## Folded into the core 2026-10-22

- #1 done: routing.error_response maps UnknownDataset to 400, caught in add_query_routes and the AC-9 router; core test tests/core/test_error_response.py, AC-13 test tightened to == 400.
- #2 done: the generated inventory lists d94ec3d0 now, so the entry reads «inventory» like every other.
- #3 done: Showcase union in core/api.ts lists ac4, ac10, ac6, ac7, ac9, ac13; every local cast and its comment removed.

