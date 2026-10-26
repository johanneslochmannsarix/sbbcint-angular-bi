# Demo app — who may write what (PLAN §14.2, built in D0 on 2026-10-21)

LOCAL-ONLY (tmp/ is gitignored). Never git add/commit/push from here; never name it in Jira, worklogs,
wiki, ADRs or platform docs.

## Ownership per showcase session (D1)

| Showcase | Backend | Frontend | Other | Dev ports (backend / ng serve) |
|---|---|---|---|---|
| AC-2 | `backend/app/showcases/ac2/**`, `backend/queries/ac2/**`, `backend/tests/ac2/**` | `app/src/app/features/ac2/**` | `parity/ac2/**`, `probes/ac2/**`, `core-requests-ac2.md` | 8766 / 4201 |
| AC-1 | `backend/app/showcases/ac1/**`, `backend/queries/ac1/**`, `backend/tests/ac1/**` | `app/src/app/features/ac1/**` | `parity/ac1/**`, `probes/ac1/**`, `core-requests-ac1.md` | 8767 / 4202 |
| AC-8 | `backend/app/showcases/ac8/**`, `backend/queries/ac8/**`, `backend/tests/ac8/**` | `app/src/app/features/ac8/**` | `parity/ac8/**`, `probes/ac8/**`, `core-requests-ac8.md` | 8768 / 4203 |
| AC-4 (2026-10-21) | `backend/app/showcases/ac4/**`, `backend/queries/ac4/**`, `backend/tests/ac4/**` | `app/src/app/features/ac4/**` | `parity/ac4/**`, `probes/ac4/**`, `core-requests-ac4.md` | 8772 / 4204 (8769 is the cockpit proxy) |
| AC-10 (2026-10-21) | `backend/app/showcases/ac10/**`, `backend/queries/ac10/**`, `backend/tests/ac10/**` | `app/src/app/features/ac10/**` | `parity/ac10/**`, `probes/ac10/**`, `core-requests-ac10.md`, `app/proxy.4205.json` | 8770 / 4205 |
| AC-6 (2026-10-21) | `backend/app/showcases/ac6/**`, `backend/queries/ac6/**`, `backend/tests/ac6/**` | `app/src/app/features/ac6/**` | `parity/ac6/**`, `probes/ac6/**`, `core-requests-ac6.md`, `app/proxy.4206.json` | 8771 / 4206 |
| AC-7 (2026-10-21) | `backend/app/showcases/ac7/**`, `backend/queries/ac7/**`, `backend/tests/ac7/**` | `app/src/app/features/ac7/**` | `parity/ac7/**`, `probes/ac7/**`, `core-requests-ac7.md`, `app/proxy.4207.json` | 8773 / 4207 |
| AC-9 (2026-10-21) | `backend/app/showcases/ac9/**`, `backend/queries/ac9/**`, `backend/tests/ac9/**` | `app/src/app/features/ac9/**` | `parity/ac9/**`, `probes/ac9/**`, `core-requests-ac9.md`, `app/proxy.4208.json` | 8774 / 4208 |
| AC-13 (2026-10-21) | `backend/app/showcases/ac13/**`, `backend/queries/ac13/**`, `backend/tests/ac13/**` | `app/src/app/features/ac13/**` | `parity/ac13/**`, `probes/ac13/**`, `core-requests-ac13.md`, `app/proxy.4209.json` | 8775 / 4209 |
| Metrics (option B, 2026-10-21) | `backend/app/showcases/metrics/**`, `backend/queries/metrics/**`, `backend/tests/metrics/**` | `app/src/app/features/metrics/**` | `parity/metrics/**`, `probes/metrics/**` | – (integrated app only) |

AC-2 was migrated into the demo by D0 from the standalone `tmp/metrics_app_spike/ac2/` (67 tests, parity
15/15 per tenant, 7 views). `ac2/` stays untouched as the reference until D2. So only AC-1 and AC-8 run in
parallel as D1 (dev limiter default 55/min).

Static files of a feature (e.g. a GeoJSON basemap, after Johannes' download OK) go into
`app/src/app/features/<ac>/assets/`; they are served at `/assets/<ac>/<file>` (angular.json, set up in D0).

## Shell-owned — D1 sessions never touch these

- `backend/app/core/**`, `backend/app/main.py`, `backend/app/showcases/__init__.py`, `backend/tests/core/**`,
  `backend/tests/support.py`, `backend/tests/__init__.py`, `backend/smoke.py`, `backend/pyproject.toml`,
  `backend/uv.lock`
- `app/src/app/core/**` (incl. `core/style.ts`, the style variant), `app/src/app/shared/**` (incl.
  `shared/ui/**`, the shared controls), `app/src/app/app.*`, `app/src/app/start/**`,
  `app/src/styles.css`, `app/src/styles-sbb.css`, `app/src/index.html`,
  `app/src/main.ts`
- `app/package.json`, `app/package-lock.json`, `app/angular.json`, `app/tsconfig*.json`,
  `app/proxy.4200.json`, `app/proxy.4201.json`, `app/proxy.4202.json`, `app/proxy.4203.json`
- `run.ps1`, `dev.ps1`, this file

Never run `npm install` / `uv add` in a D1 session: everything is installed (D0). A missing package is a
core request.

## Controls: always shared/ui (style variant, 2026-10-25)

The app has two style variants with identical content, switched at runtime (`core/style.ts`, header «Stil»,
`?style=demo|sbb`): the demo's own look and the customer's (SBB lean, `@sbb-esta/angular`). Features therefore
never write raw controls: segmented groups are `<ui-seg>`, dropdowns `<ui-select>`, buttons `<ui-button>`, date
fields `<ui-date>`, data tables `<table class="tbl" uiTable>` (all from `shared/ui`). Each renders today's markup
in the demo variant and the SBB component in the sbb variant. Chart colours come from `ThemeService.tokens()`
(never a TOKENS constant by mode), so they follow the variant. Mapping, tokens and limits: `STYLE-VARIANT.md`.

## Core-request rule (PLAN §14.3)

If a D1 session needs something in the core, it writes the request to its own `core-requests-<ac>.md`
(never a shared file), solves it locally inside its feature folders, and D2 folds it into the core. No D1
session edits the core.

## What the core gives you

Backend (`backend/app/core/`):
- `datasets.py` — the only datasets: `import` × {CARGOCONTROL, RTS} × {PROD, QA}, `leitstelle_olten` ×
  CARGOCONTROL × {PROD, QA}, `platform_metrics` (all ids confirmed against the inventory, see the docstring).
- `queries.py` — named queries `queries/<ac>/[<cc|rts>/]<name>.dax` + `<name>.roles.json` (column → role,
  typed params whitelist; format in the module docstring). Startup refuses a definition that breaks it.
- `masking.py` — the ONE masking layer. Roles: id, code, measure, date, label_org, label_qualification,
  label_location, label_technical (pass through; label_technical = names of technical objects such as
  steps, tables, activities, added for /metrics); label_person (→ pseudonym `P-…`, HMAC per process over tenant + person
  key, same in every showcase of one process); label_freetext (→ token `T-…`). Real labels only with
  `DEMO_REAL=1` (`run.ps1`, the default since 2026-10-23; sessions always pass `-Masked`). A returned column without a role → 502.
- `forbidden.py` — one home for forbidden columns: absence reasons + birth dates everywhere, IST/executed
  times under `queries/ac1/`, AC-2 minimisation under `queries/ac2/`. Startup and a test fail on a hit.
- `bronze.py` — read-only Delta reader, ANALYTICS_CORE Bronze, schemas RTS_/CARGOCONTROL_ PROD/QA only,
  tables `public_abstractcustomlocation` / `public_location` only, named columns only, never an address column
  (`FORBIDDEN_COLUMNS` / `FORBIDDEN_PARTS`, refused before any I/O). Never LOCLOCATION.
- `service.py` — `QueryService.run(showcase, name, raw_params, fresh=, transform=)`: guard, cache (10 min),
  limiter (per instance, `DEMO_LIMIT_PER_MIN`), masking. A `transform` (e.g. AC-1's ALP:/TN:/Prüfer: parser)
  sees raw rows server side; its output columns must be declared (`columns` or `derived`) and are masked.
- `routing.py` — `add_query_routes(router, "<ac>")` (GET /queries, GET /q/{name}), `core(request)`,
  `error_response(e)`.

Frontend (`app/src/app/`):
- `core/api.ts` (ApiService, `MaskedPerson` / `Pseudonym`, `personOf`, `personText`), `core/query.ts`
  (`createQuery`, `queryFactory('<ac>')`, `createGet('<ac>', () => ({ path, params }))` for a showcase's own routes), `core/theme.ts` + `core/tokens.ts` (light/dark, chart tokens,
  echarts themes `demo-light` / `demo-dark`), `core/format.ts`, `core/filters.ts`,
  `core/echarts-setup.ts` (every chart type the handovers list; `registerMap`, `connect`),
  `core/header-slot.ts` (`<ng-template appHeader>` / `appHeader="sub"`).
- `shared/chart-card.ts` (loading / error / empty), `shared/chart-resize.ts`, `shared/chart-opts.ts` (`ariaDecal()`:
  decals off, per-item decals documented), `shared/connect.ts` (`chartGroup="ac8-…"`), `shared/pseudonym-chip.ts`
  (`<app-pseudonym>`), `shared/merge-options.ts` (`[mergeOptions]`: setOption with `replaceMerge`),
  `shared/qual-link.ts` (`<app-qual-link>`: a person's qualifications in AC-2, same pool only).
- `story/` (D2): the shared story mode. A page registers its state with `StoryService.register('<ac>', …)`.

## DAX traps for showcase authors (core request ac1 #3, found by AC-1, 2026-10-21)

- **The blank member rides along in `TREATAS ( VALUES ( dim_x[key] ), fact[key] )`.** `VALUES` includes the
  blank row of a dimension that has unmatched fact rows, so the filter also matches fact rows *without* a
  key — on RT&S `fact_person_tour_day` 21 PROD / 37 QA rows without a person. Filter
  `NOT ISBLANK ( dim_x[key] )` (or use the report's own population, e.g. `worker_type_name`), and check a
  parity script against the report before trusting a count.
- **Type the blanks in a `UNION`.** An untyped `BLANK ()` standing in for a datetime column made AC-1's
  `day_tags` run > 45 s. Use `CONVERT ( BLANK (), DATETIME )` (and the matching type for other columns).

## Running

- `dev.ps1 -Showcase ac1|ac2|ac8 [-LimitPerMin 55]` — that showcase's backend + ng serve with its proxy.
  Open `http://localhost:<port>/<ac>`. Always masked. No production build in D1 (D2 does it).
- `run.ps1 [-Masked]` — integrated: backend 8765 (110/min), ng serve 4200. Real by default (Johannes, 2026-10-23); sessions always `-Masked`.
- Offline tests: `uv run --project backend --directory backend pytest -q` (a D1 session runs its own
  `tests/<ac>` plus the core suite; never edits `tests/core`).
- Probes / parity: `demo\py.ps1 probes\<ac>\<script>.py [args]` (`app` importable, always masked; no PYTHONPATH).
