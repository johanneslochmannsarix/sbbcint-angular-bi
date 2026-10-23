# Core requests — AC-7 (2026-10-21)

LOCAL-ONLY. The AC-7 session made only the additive core lines the handover allowed (listed under «Done»); everything
else is a request here, solved locally in `features/ac7/` / `showcases/ac7/`.

## Done by the AC-7 session (handover-sanctioned, additive)

- `backend/app/core/datasets.py`: model `au_verleihliste` (sm_au_verleihliste), RTS × PROD / QA; ids checked against
  `docs/reference/workspace-inventory.md` and the `model_id` of `scripts/ac7/build_verleihliste_rdl.py`.
- `backend/app/core/queries.py`: `"ac7"` in `SHOWCASES` (mounts `/api/ac7`); `main.py` CORS + docstring: 4207 / 8773.
- `dev.ps1`: `-Showcase ac7` → backend 8773, ng serve 4207, `app/proxy.4207.json`.
- `app.routes.ts` lazy route `/ac7`, `app.html` nav tab, start-page tile (question, Stand, scope), `OWNERSHIP.md` row.

## Requests

1. **Count asserts in `tests/core` (same as ac4 #2) — patched minimally, please fold.** `test_app.py`
   (`len(h["datasets"]) == 11`), `test_guard_cache_limiter.py` (`len(D.REGISTRY) == 11`) and `test_definitions.py`
   (`set(reg) == {…seven showcases}`) broke the moment AC-7 and the parallel AC-9 session added their models (15
   datasets, nine showcases). Changed to `>= 11` / a superset that equals `Q.SHOWCASES`, each line commented, so every
   later showcase stays green. Better: assert the key set per model.
2. **`locations.py` (classify + Bronze join by name) into the core.** AC-7's `/api/ac7/locations` imports
   `app.showcases.ac1.locations` read-only (no edit) for the same coordinate route and the same «address-like names
   withheld» rule. One home would be `core/locations.py`.
3. **A `token` param type (reverse lookup of a `T-…` text token).** The core resolves pseudonyms server side but not
   free-text tokens. AC-7 solves it locally: `/api/ac7/auftraege` adds `auftrag_token` with a transform (token of the
   raw name, every mode), and `/api/ac7/v/<view>?auftrag=T-…` resolves the token to the order name's rank
   (`auftrag_nr`) before the named query runs. A core `token` type (`Masker.resolve_text`) would remove the router step.
4. **`'ac7'` in the `Showcase` union** (`app/src/app/core/api.ts`); today `features/ac7/data/store.ts` and the start tile
   cast `'ac7' as Showcase` (as ac4 / ac10 / ac6 do).
5. **`createGet` requests are not counted in the shell footer.** `ApiService.fabricCalls` / `requests` only count
   `query()`; AC-7's filtered views go through `createGet` (`/v/<view>`, `/auftraege`, `/locations`), so the footer
   «Fabric-Abfragen dieses Tabs» under-reports on /ac7 (the backend's own counter in the same footer is right).
6. **Non-ASCII enum values** (same as ac4 #4): the core enum pattern refuses `Ü` and `+`, so the Geschäftsart filter
   travels as `AU | DL | AU_DL` and the DAX maps it back (`SWITCH`); Tätigkeit / Ort travel as ranks.
7. **A data-as-of for models without their own stamp.** `sm_au_verleihliste` has none; AC-7's `stand` reads the RT&S
   import model's `[Datenstand_Datum]` (same Gold run) and labels it so. A core «chain stand» per tenant/env would let
   every RT&S showcase share one query.

- 2026-10-22: the Showcase-union request (#4) is done in core/api.ts; the local cast is removed.

