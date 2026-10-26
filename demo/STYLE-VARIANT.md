# Style variant «SBB» — same content, the customer's look (LOCAL-ONLY)

`tmp/` is gitignored; never name the demo in Jira, worklogs, wiki, ADRs, the board or platform docs. Built
2026-10-24/25 from `HANDOVER-SBB-STYLE.md`. **Brand rights are open** (see the end): build and show internally
only; do not show, send or publish the SBB variant outside until Johannes has decided.

## What it is, how to switch

One codebase, two runtime style variants with identical routes, queries, numbers and texts:

| | demo (default) | sbb |
|---|---|---|
| Look | the demo's own (Segoe UI / Bahnschrift, blue accent) | SBB design system for business apps, **lean** (`@sbb-esta/angular` 22.2.0), SBBWeb, SBB red chrome |
| Switch | header button «Stil: Demo» | header button «Stil: SBB» |
| URL | `?style=demo` | `?style=sbb`; `&colors=off-brand` = SBB's security-critical style (red only for errors, blue chrome) |

The choice is remembered per browser (localStorage `demo-app.style`, `demo-app.sbb-colors`; `?colors=brand` resets
off-brand). Light / dark: the existing theme button works in both; in the sbb variant it sets SBB's `sbb-light` /
`sbb-dark` (lean dark mode).

## How it is built

- `core/style.ts` — `StyleService.variant` (`'demo' | 'sbb'`, from `?style=`, then localStorage, default demo). sbb:
  `sbb-lean` (+ `sbb-off-brand-colors`) on `<html>` and the lazy stylesheet `sbb.css` linked; demo: classes removed,
  stylesheet disabled. It also re-announces lean to SBB's component variant switch (`ɵvariant`, see Traps).
- `src/styles-sbb.css` → bundle `sbb.css` (angular.json `"inject": false`): SBB `typography.css` **inside
  `@layer sbb`**, the demo's tokens (`--plane`, `--surface`, `--ink`, `--accent`, fonts …) mapped to SBB lean
  colours, the showcases' own font tokens mapped to SBBWeb, and a few shell rules. Nothing of it exists in the demo
  variant. `styles.css`: only the element defaults that would fight SBB components (`body`, `button/input/select`,
  `a`, `:focus-visible`) are scoped to `:where(html:not(.sbb-lean))` — zero specificity change.
- `core/tokens.ts` — `SBB_TOKENS` (light/dark), `chartTokens(variant, mode)`, `ECHARTS_THEMES` (`demo-*`,
  `sbb-*`, registered in `core/echarts-setup.ts`); `FONT_UI` / `FONT_NUM` are live bindings switched with the
  variant. `ThemeService.tokens()` / `echartsTheme()` follow the variant; AC-2's status tokens and AC-13's palette
  were made variant-aware the same way.
- Shell: `app.html` renders the demo header or, in `@defer`, `app.sbb-header.ts` — `sbb-header-lean` (label
  «Demo», SBB logo = the header's default), the ten showcases as `sbb-tab-nav-bar`, the page's header slots in a
  bar below. Ten links do not fit the lean header (four were cut off at 1600 px).
- `shared/ui/` — the shared controls, the only place besides the shell that knows the variant (unit test
  `ui.spec.ts`, both branches). Each renders today's markup in the demo variant (host `display: contents`, so the DOM
  and layout are unchanged) and the SBB component in the sbb variant, **inside `@defer`**: SBB code is loaded only
  when the sbb variant shows. Imports are the standalone SBB classes (NgModules cannot be deferred).

## Inventory and mapping

Controls replaced (count per feature; counted after the migration in the source):

| Feature | ui-seg | ui-select | ui-button | uiTable | ui-date |
|---|---|---|---|---|---|
| ac1 | 2 | 2 | 4 | 0 | 0 |
| ac2 | 6 | 0 | 6 | 1 | 0 |
| ac4 | 4 | 3 | 3 | 3 | 0 |
| ac6 | 7 | 4 | 2 | 1 | 0 |
| ac7 | 4 | 3 | 5 | 0 | 0 |
| ac8 | 7 | 1 | 4 | 1 | 0 |
| ac9 | 3 | 1 | 1 | 2 | 0 |
| ac10 | 5 | 4 | 2 | 1 | 0 |
| ac13 | 3 | 2 | 2 | 0 | 0 |
| metrics | 3 | 2 | 7 | 6 | 2 |
| start / story / chart-card | 1 | 0 | 6 | 0 | 0 |
| **total** | **45** | **22** | **42** | **15** | **2** |

| Demo control | SBB counterpart (doc read first) | Notes |
|---|---|---|
| `.seg` group, 2–3 options, one pressed | `sbb-toggle` + `sbb-toggle-option` (toggle.md: two options, a third in lean) | sbb-toggle selects its first option on its own and reports it; `ui-seg` passes on only a change to another value |
| `.seg` group, > 3 options, none pressed, disabled option, or actions (‹ ›) | row of `sbb-secondary-button`, the pressed one `sbb-button` (button.md) | no SBB control for a 5-way single choice; `sbb-tag` is multi-select with an «All» tag (tag.md), `sbb-tabs` are page sections |
| `select.select` | `sbb-select` + `sbb-option` in `sbb-form-field` (select.md) | values stay strings; only `selectionChange` (a user pick) is passed on |
| `button.btn` / `.btn-primary` / `.btn-ghost` / `.is-on` | `sbb-secondary-button` / `sbb-button` / `sbb-ghost-button` / `sbb-button` | |
| `input[type=date]` (metrics) | `sbb-datepicker` + `sbbDateInput` + `sbbInput` (datepicker.md, native date adapter default) | «yyyy-mm-dd» built from the local date fields, as the doc recommends |
| `table.tbl` | class `sbb-table` on the same table (`uiTable`); SBB's cell styles come from typography.css | the CDK form (`sbb-table` + `dataSource` + column defs, table.md) would rebuild every hand-written row (click handlers, marks, colspans); no sorting / paginator added (content identical) |
| loading spinner (chart-card) | `sbb-loading-indicator mode="small"` with aria-label (loading-indicator.md) | |
| shell tabs | `sbb-tab-nav-bar` + `sbb-tab-link` (tabs.md) | tabs.md wants `sbb-tab-nav-panel` around the outlet; the outlet is shared by both variants, so the bar runs without `tabPanel`, which SbbTabNav handles as plain links with `aria-current="page"` (fesm2022/tabs.mjs) |
| header | `sbb-header-lean`, tools in `.additional-header-content` | no `sbb-usermenu` (no login) |

**No SBB counterpart, tokens only:** cards, KPI tiles, the Gantt / calendar / map views, drawers and scrims, chips
(`.sel-chip`, `.chip`), `.linkish` text buttons, the pseudonym chip, the story panel's frame (its buttons are
`ui-button`), native `title` tooltips (kept: `sbbTooltip` is a click/hover overlay with other semantics), AC-10's
«auch besetzte» checkbox. **Left as demo markup on purpose:** metrics «Stage» group (labels carry a colour key),
metrics page nav (router links styled `.seg`), five tables that are not `.tbl` (AC-13 ×3 `ac13-tbl`, AC-9 `lines`,
AC-7 print form `ac7-sheet-tbl`), the one `a.btn` link (metrics stability). They take the SBB tokens.

## Tokens

CSS (sbb variant, `styles-sbb.css`): light `--plane` milk #f6f6f6, `--surface` white, `--ink` black, `--ink-2` iron
#444444, `--muted` metal #767676, `--rule` cloud #e5e5e5, `--rule-strong` cement #bdbdbd, `--accent` SBB red (blue in
off-brand); dark `--plane` midnight #151515, `--surface` charcoal #212121, `--ink` white, `--ink-2` silver #dcdcdc,
`--muted` storm #a8a8a8, `--rule` #333333, `--rule-strong` anthracite #5a5a5a. Fonts: SBBWeb, regular / bold / light cuts.

Charts (`core/tokens.ts` `SBB_TOKENS`): categorical slots from the SBB spot colours (sky, orange, green, violet,
peach, night), lightness-stepped in OKLCH into the dataviz band; slot 6 a second green as in the demo tokens. SBB red
is never a series (critical keeps the failure red). Validated with the dataviz skill's `validate_palette.js`:

| Mode (surface) | slots 0–6 | result |
|---|---|---|
| light (#ffffff) | #0079c7 #da720a #0a6728 #8c40a0 #ba8901 #426cbb #21a447 | all pass; worst adjacent CVD ΔE 12.7, normal-vision 27.1, contrast ≥ 3:1 |
| dark (#212121) | #1682d0 #af5b08 #2baa4e #b86bcd #a07503 #618de0 #088233 | all pass; worst adjacent CVD ΔE 8.8, normal-vision 24.0 |

Sequential (sky): light #d1e8fe #a1d0fc #62b4fe #3295e5 #0676c1 #015893 #023f6c; dark the reverse steps
#003053 … #a7d3fd. AC-2 status trio (slots 0–2) all-pairs: light worst CVD 12.7, dark 8.8 — pass. AC-13 trio (slots
0, 2, 4): light pass; dark CVD 6.7 = floor band, legal with the existing secondary encoding (legend with counts,
texture on Urlaub). **AC-4, AC-6, AC-9 keep their own palettes in both variants**: they are the hues of the
customer's Power BI reports, validated in their own files (dark steps against #161c21, close to SBB's #212121).

## Fonts, CDN, offline

- `typography.css` (114.8 kB unminified) loads SBBWeb **from `cdn.app.sbb.ch`** (subset `v1_9_subset`, 5 woff2);
  the npm package ships no font. Coverage measured in the browser (glyph-width test against monospace): the subset
  has ä ö ü ß Ä Ö Ü é è à ç œ € « » – ’ Ø, not ł ő ș Ω Ж → ✓ (those fall back per glyph to Helvetica / Arial).
  German UI texts need no `fullfont.css` (it would add 10 more CDN font files).
- Icons: `sbb-icon` would fetch from `icons.app.sbb.ch`. All 14 names the used components ask for are registered
  as self-drawn SVG literals (`shared/ui/sbb-icons.ts`), so **no icon request leaves the app**, online or offline
  (the tabs' `chevron-left-small` was found by the request survey below and added).
- Chart fonts: canvas text needs the family name, so `core/tokens.ts` reads it from the stylesheet variable
  `--ui-chart-font` once `sbb.css` has loaded and re-creates the charts with a revisioned theme (`sbb-light-<rev>`);
  the JS bundles never name the SBB font (the package leak gate matched its family name against a real first name).
- Runtime requests to SBB hosts, measured with `probes/style/offline_check.mjs --urls` on the masked dev pair
  (cold load per route): **sbb variant: `cdn.app.sbb.ch` ×3 per load** (three woff2 under `fonts/v1_9_subset/`: the regular,
  bold and light cuts), nothing else; `icons.app.sbb.ch` 0. **demo variant: no external request.**
- Offline package (Johannes 2026-10-24: no SBB font shipped, nothing requested): `package-src/web_overlay.py`
  imports a copy of typography.css **without its `@font-face` rules** (and fails if any remote `url()` is left);
  the SBB font stack falls back to Helvetica Neue / Arial. The synthetic banner is also patched into the SBB header.
  Result (2026-10-25, `offline_check.mjs --offline` on the staged package, every host except 127.0.0.1 unresolvable):
  11 routes × 2 variants, **0 failed requests, 0 external requests, 0 console errors**; the SBB variant renders
  with Arial, the local icons and the banner. Leak gate: labels 0 (after «Begleitung» joined the KEPT vocabulary,
  Johannes 2026-10-25, and the font name left the JS), secrets / code 0, **numbers 1: a synthetic KPI total equals
  a real headline total today** — a coincidence in the synthetic data, present before this work; the gate stays
  red and no zip is written until it is resolved (see Open).

## Checks

- **Content parity** (`probes/style/parity_run.mjs`, headless Chrome over CDP, masked dev pair, light and dark):
  per route and main filter state, hashes of KPI tiles, table cells, card headings / notes / state texts and every
  ECharts instance's series / dataset / category data (style keys removed) in both variants on the same page state.
  Final run 2026-10-25 (`parity_run.mjs --mode both`): 27 route / filter states per mode, **26 match in light
  and in dark**. The one mismatch, in both modes, is AC-4 «Planmonat» — the pre-existing stale chart described under
  Traps (the demo variant keeps the previous month's bars; the content of the page is otherwise identical). Dark
  pass: 0 console errors; light pass: 34 × HTTP 429 from the dev backend's own limiter (it ran next to the package's
  leak gate), reported, not counted. Normalised before hashing: epoch values within 5 min of now («now», AC-8's
  open-ended version bar) and charts under a card state overlay (their state text is compared instead).
- **Demo variant unchanged**: pixel diff of AC-10, AC-2, AC-9 and the start page (1600 × 1400, light and dark)
  against a frozen pre-change copy served on the same masked backend: identical except the header row (the new
  «Stil: Demo» button shifts the header slot); the only other differing pixels match the run-to-run noise of two
  identical builds (AC-2 heatmap rows 431–496, the start page footer counter).
- Unit tests: `ng test` 2/2 (shared/ui, both branches). Production build without errors.

## Bundle (production build, `ng build`)

| | before | after |
|---|---|---|
| Initial total | 325.35 kB raw / 88.81 kB transfer | 387.25 kB / 110.20 kB (+62 / +21 kB: style service, the shared control shells, the async animations loader, chunk split; no SBB component code) |
| AC-10 page chunk (demo default load) | 67.24 kB / 18.83 kB | 66.57 kB / 18.89 kB |
| SBB variant, extra lazy | – | `sbb.css` 105.98 kB / 12.81 kB (typography.css minified + mapping); header 102.09 / 17.20 kB; animations engine 64.39 / 17.25 kB; toggle 23.85 / 5.90 kB; select 23.44 / 6.72 kB; date field 70.46 / 13.81 kB (metrics only); loading indicator ≈ 8 / 2 kB; shared CDK / core chunks ≈ 150 / 40 kB |
| Build time | 15 s | 10–12 s (same machine, noise) |
| Cold load, bytes over the wire (offline package, AC-10) | 1736 kB (30 requests) | 2243 kB (51 requests), +507 kB; start page 428 → 892 kB (the package server sends uncompressed; data included) |

## Traps found on the way

- `@angular/animations` **is required** although `@sbb-esta/angular` does not list it as a peer: 12 modules
  import `trigger/state/…` directly (select, toggle, header-lean, table, tabs …). Installed 22.2.3 (Johannes OK
  2026-10-24); `provideAnimationsAsync()` (deprecated since 20.2, removal planned for v23).
- SBB components read the design variant once, when `SbbCommonModule` is constructed (`ɵvariant`); that happens
  as soon as a shared control is created, also in the demo variant. `StyleService` re-announces `lean` (lazy import
  of the exported `ɵvariant`, version-pinned) on every switch to sbb.
- `@defer` loads only standalone components; importing `Sbb*Module` made all SBB code eager (initial 684 kB). The
  datepicker's providers (scroll strategy, native date adapter) came from `SbbDatepickerModule`: they now sit on
  `shared/ui/date-sbb.ts`, a separate file so the defer can split it.
- A component's own (emulated) styles do not reach markup rendered inside a shared control: three rules now use
  `:host ::ng-deep` / `::ng-deep` (AC-2 heatmap `.btn.is-on`, AC-4 tour-drill `.ac4-more`, story panel mobile).
- Dev builds only: SBB's sanity check logs «Could not find @sbb-esta/angular typography» (HMR loads `@defer`
  dependencies eagerly, NG0751, and the demo variant has no typography by design). Production runs no checks.
- **Pre-existing bug found by the parity check (not caused by the variant):** AC-4 «Welche Personaltypen fahren …»,
  right chart: when the selection has no person types, `right()` is null and the chart keeps the previous
  selection's bars; any theme change (also the old light/dark toggle) then empties it. The parity check reports
  that state as a mismatch: the demo variant still shows the stale bars, the re-created SBB chart shows none.

## Screenshots (masked, `style-variant/`)

`ac10-*`, `ac2-*`, `ac9-*`: `-demo-before` (pre-change), `-demo-after`, `-sbb-light`, `-sbb-dark`; and
`ac9-sbb-off-brand.png` (red only for errors, blue chrome) to choose between SBB red chrome and off-brand.

## Open for Johannes

1. **Brand rights**: the code is Apache-2.0, but SBBWeb, the SBB red and the logo (the lean header shows it by
   default) belong to SBB, and the customer is its own company. May we show it to the customer, and how
   to ask?
2. **Off-brand or brand colours** (`?colors=off-brand`): recommendation below.
3. **Subset or fullfont**: subset suffices for German texts (measured); fullfont only if real names or places
   with ł ő ș … must render in SBBWeb.
4. AC-4 / AC-6 / AC-9 palettes: keep the customer's Power BI hues in the SBB variant (now), or derive SBB ones?
5. Package leak gate: one synthetic KPI total equals a real headline total (present before this work). Reseed the
   synthetic base (`build.ps1 -Generate -Seed <new>`) or look at that KPI in the generator? No zip until then.
6. AC-4 «Welche Personaltypen fahren …»: fix the stale right-hand chart (pre-existing, also on light/dark)?

**Off-brand recommendation:** use `?colors=off-brand` for customer demos of the data pages. The demo's dataviz rule
reserves red for failures (AC-10's critical bars, error states), and SBB's own off-brand style exists for exactly
that: red only for errors. Brand red on toggles and buttons sits right next to red «critical» marks
(`ac10-sbb-light.png`). The brand version stays one URL parameter away if recognisability matters more.
