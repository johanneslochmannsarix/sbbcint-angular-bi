# Core requests — AC-9 (2026-10-21)

LOCAL-ONLY. The AC-9 session made the narrow core additions its handover allowed (each listed under «Done»).
Everything else is a request here, solved locally in `backend/app/showcases/ac9/` and `app/src/app/features/ac9/`.

## Done by the AC-9 session (handover-sanctioned, additive lines only)

- `backend/app/core/datasets.py`: model `rechnungslegung` (sm_rechnungslegung_rts), RTS × PROD `0789cd46` / QA
  `df0ce5da`; ids checked against `docs/reference/workspace-inventory.md`, the landing-report generator's `sm_id`
  and (QA) the report's `definition.pbir` + the RDL. Test: `tests/ac9` `test_rechnungslegung_dataset_ids`.
- `backend/app/core/queries.py`: `"ac9"` in `SHOWCASES` (mounts `/api/ac9`); `main.py` docstring + CORS
  `http://localhost:4208`. The core count asserts were already supersets (AC-7's fix), so no core test changed.
- `dev.ps1`: `-Showcase ac9` → backend 8774, ng serve 4208, `app/proxy.4208.json`.
- `app.routes.ts` lazy route `/ac9`, `app.html` nav tab, start-page tile (question, Gold write time as data-as-of,
  scope), `OWNERSHIP.md` row.
- `story/story.ts` (Johannes' go, 2026-10-21): host `ac9` (Ac9Store), Ctx `rlMonth` / `rlAuftrag`, three steps after
  the AC-2 RT&S step (Beleg of the last full month → its largest order → that order's longest tour); the page
  registers in `Ac9Page`. Verified live masked on PROD and QA (captions, ‹ Zurück, 0 console errors).

## Requests

1. **`'ac9'` in the `Showcase` union** (`app/src/app/core/api.ts`): `features/ac9/data/store.ts`,
   `views/auftrag-drill.ts` (AC-7's route) and the start tile cast `'ac9' as Showcase` / `'ac7' as Showcase`.
2. **A server-side handle for free-text filters.** AC-9 filters by order name, a free text masked to `T-…`. The core
   resolves person pseudonyms (`pseudonym` param type) but not text tokens, so AC-9 (like AC-7, and AC-10 / AC-6 with
   ordinals) built its own: the router maps token → the order's ordinal in the model's sorted name list (captured by
   a transform of `auftrag_liste` / `auftraege`, which swap the ordinal for `auftrag_token`) and the DAX resolves the
   ordinal back. A core `token` param type (validate `T-…`, resolve through `Masker` to a value the DAX can compare
   safely, e.g. an ordinal map the core keeps per query + env) would replace four local variants. Until then the
   echo column (`auftrag_echo`) catches a model refresh between list and filter.
3. **Echo of resolved params.** `QueryService.run` returns `params` after resolution, so a showcase that resolves a
   handle before the core sees it would echo the raw key (doi_id, ordinal) to the browser. AC-9's router restores
   the browser's handles in a copy of the payload (`tests/ac9 test_resolved_keys_never_echo_back`). Suggest the
   core echo the request's original values, or let a router declare "echo as sent" keys.
4. **A generic id pseudonym.** The tour pseudo-id `D-…` (HMAC over doi_id, `showcases/ac9/ids.py`) is the same
   mechanism as the person pseudonym without the tenant; a core `pseudo_id` role (mask an id column to a
   per-process HMAC handle, resolvable as a param) would serve AC-9 tours, AC-10 positions and AC-4 tours alike.
5. **Cross-showcase deep links** (D2): AC-9 links to AC-7 with AC-7's own URL keys (`/ac7?a=<token>` for an order,
   `/ac7?d=<pseudonym>` for a person) and reads AC-7's `GET /api/ac7/auftraege` to show the order link only where the
   order is a stint there. That couples to AC-7's route and key names; a small registry of deep-link contracts in
   the core would keep it from breaking silently.
6. **Long-task measurement in the browser pane.** `PerformanceObserver({type: 'longtask'})` reports nothing in the
   in-app browser (positive control: a 120 ms busy loop is not reported); AC-9 measured main-thread blocks with a
   5 ms timer-gap probe instead (control 120 ms → 120 ms). Worth one shared helper if D2 wants comparable numbers.

- 2026-10-22: the Showcase-union request (#1) is done in core/api.ts; the local cast is removed. UnknownDataset (env without a model) now also answers 400 in the AC-9 router.

