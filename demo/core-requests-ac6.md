# Core requests from AC-6 (PLAN §14.3)

Written by the AC-6 session only. Each request: what is missing in the core, why the feature needs it, how it
is solved locally for now (file in the feature folder), and what D2 should fold in. D2 marks it done.

Additive lines the AC-6 session made itself in shared files (as its handover allows, each re-read right before
the edit): `"ac6"` in `backend/app/core/queries.py` SHOWCASES (that is what mounts the router - main.py takes its
list from there), `main.py` docstring + CORS origin 4206, `tests/core/test_definitions.py` expected showcase
set, `dev.ps1` ac6 slot (8771 / 4206), `app/proxy.4206.json`, the lazy route in `app.routes.ts`, the nav tab in
`app.html`, the start-page tile (`start/start-page.ts`), the AC-6 row in `OWNERSHIP.md`. Model "fico" was already
registered by AC-4 (`core/datasets.py`); not registered twice.

| # | Date | Core area (file) | Request | Local workaround (where) | D2 status |
|---|------|------------------|---------|--------------------------|-----------|
| 1 | 2026-10-21 | `app/src/app/core/api.ts` `Showcase` | `'ac6'` (like `'ac4'`, `'ac10'`) is missing from the `Showcase` union, so `queryFactory('ac6')` does not type-check. | `features/ac6/data/store.ts`: `queryFactory('ac6' as Showcase)`; same cast in the start tile | open |
| 2 | 2026-10-21 | `backend/app/core/queries.py` param types | A label filter has no param type: names (versions, Tourstandorte, Personaltypen, Tätigkeiten) are not static enums and may hold characters `_ENUM_RE` refuses. AC-6 sends the **rank** of the value in the sorted, non-blank column (`int`) and resolves it in the DAX (AC-4's pattern for Personaltyp, applied to every label). A core param type «rank of `'table'[column]`» (resolution block generated, not hand-copied into twelve `.dax` files) would remove ~15 lines of DAX per filter. A model refresh can shift ranks; every AC-6 query echoes the resolved names (`sel_*` in `kpi`) and the page shows «Modell neu geladen: Auswahl prüfen» on a mismatch. | the resolution block repeated in `queries/ac6/*.dax`; drift check in `data/store.ts` `drift` | open |
| 3 | 2026-10-21 | `app/src/app/shared/merge-options.ts` (doc) | **A container resize during a universalTransition morph leaves the old shapes stuck** (measured 2026-10-21 on AC-6: polar bars → cartesian bars and sunburst → bar both stuck while the chart height changed with the shape; both morph cleanly with one constant height). This is very likely what AC-4 saw with its treemap → ranking morph (height 420 ↔ rows × 22). Document in `merge-options.ts`: keep the chart's size constant across a morph (or resize only after `animationDurationUpdate`). | `features/ac6/views/wochenuhr.ts` (450 px both shapes), `features/ac6/views/hierarchy.ts` (470 px both shapes, ≤ 20 bars) | open |
| 4 | 2026-10-21 | AC-4 feature (not core) | Cross-link «Planung (JUP) ansehen» from `/ac4` and back: AC-4 exposes no route parameter yet. AC-6 accepts `/ac6?tourstandort=<name>` (resolved to the rank once `dims` is there). AC-4 can link with its Tourstandort name; a link from AC-6 to `/ac4?tourstandort=…` needs AC-4 to read that parameter. | none in AC-6 yet (no AC-4 parameter to target) | open |
| 5 | 2026-10-21 | `app/angular.json` budgets (report, no raise) | `features/ac6/ac6.css` is 6.57 kB minified against the `anyComponentStyle` warning budget of 4 kB (error 8 kB): a warning in the production build. Not raised by AC-6. | – | open |

- 2026-10-22: the Showcase-union request (#1) is done in core/api.ts; the local cast is removed.

