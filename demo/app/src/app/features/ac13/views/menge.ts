import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { MaskedPerson, personOf, personText } from '../../../core/api';
import { dateLong, dateOnly, dayMs, isoDay, minutes, num, timeLocal, localMs } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { PseudonymChip } from '../../../shared/pseudonym-chip';
import { ariaDecal, esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac13Colors, urlaubDecal } from '../data/palette';
import { Ac13Store } from '../data/store';
import { GridRow } from '../data/types';

const VISIBLE_ROWS = 34;
const ROW_PX = 15;
const BAND_PX = 118;
/** cell states (value dimension 2 of the heatmap) */
const TOUR = 1, RUHE = 2, URLAUB = 3, TOUR_UND_FREI = 4;

interface Person { key: string; person: MaskedPerson | null; heimat: string; cells: number; touren: number; frei: number }

/**
 * View 1 - «SBB CD Menge» as a person × day calendar (A4, rule v1-monat_mit_eintrag), the hero. Q1 ruling (a),
 * Johannes 2026-10-21: a person's cell is painted only for a staffed tour or a Ruhetag / Urlaub (the AC-12 family,
 * catalogue konto_typ); «übrige Abwesenheit» and «ohne Eintrag» have no person (D1) and appear only in the band
 * above, merged into one grey category, never per person and never split per Standort-day. Rows = persons by
 * Heimatstandort (D2: absences sit there), then by most painted days. One chart, two grids on one day axis: the
 * band (person-days per day) and the grid. A row click opens that person's tours of the month (table view of the
 * row); a band click picks the day for the day drill (view 4). Pseudonyms only: P-… in masked mode.
 */
@Component({
  selector: 'ac13-menge',
  styleUrl: './menge.css',
  encapsulation: ViewEncapsulation.None,
  imports: [NgxEchartsDirective, ChartResize, ChartCard, PseudonymChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wer war im Monat an welchem Tag auf Tour, in Ruhe oder im Urlaub?" [q]="[store.grid, store.standortTage]"
              emptyNote="Für diese Auswahl hat keine Person eine Tour oder einen Ruhe- / Urlaubstag.">
      <div card-tools class="ac13-legend" aria-label="Legende">
        <span><i [style.background]="c().tour"></i>Tour ({{ n(totals().tour) }})</span>
        <span><i [style.background]="c().ruhe"></i>Ruhetag ({{ n(totals().ruhe) }})</span>
        <span><i class="ac13-hatch" [style.background]="c().urlaub"></i>Urlaub ({{ n(totals().urlaub) }})</span>
        <span><i class="ac13-dot" [style.background]="c().ue"></i>Übernachtungstour</span>
        <span><i [style.background]="c().rest"></i>übrige Abwesenheit oder ohne Eintrag (nur Summe)</span>
      </div>
      <p class="ac13-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))"
           aria-label="Kalender Person mal Tag; Zeile anklicken zeigt die Touren der Person, Balken oben anklicken wählt den Tag"></div>
      <p class="ac13-note">
        Ungemalte Zellen sind «übrige Abwesenheit» oder «ohne Eintrag»: die beiden haben im Export keine Person und stehen
        nur als gemeinsame Anzahl je Standort und Tag im Band (Entscheid 21.10.). Zeilen = Personen mit einer Tour oder
        einem Ruhe- / Urlaubstag im Monat, nach Personal-Standort; blättern mit dem Schieber rechts oder Shift + Mausrad. {{ store.stand.rows()[0]?.hinweis_ohne_eintrag ?? '' }}
      </p>
      @if (sel(); as p) {
        <div class="ac13-person" role="region" aria-label="Touren der gewählten Person">
          <div class="ac13-person-head">
            @if (p.person) { <app-pseudonym [person]="p.person" /> }
            <span>{{ p.heimat }}: {{ n(p.touren) }} Touren, {{ n(p.frei) }} Ruhe- / Urlaubstage im Monat</span>
            <button type="button" class="linkish" (click)="store.pickPerson(null)">schliessen</button>
          </div>
          <div class="ac13-list">
            <table class="ac13-tbl">
              <thead><tr><th>Datum</th><th>Tour</th><th>Tour-Standort</th><th>Personaltyp</th><th>Plan</th><th>Start → Ziel</th>
                <th class="num">Arbeitszeit v1</th><th class="num">angerechnet</th><th>Übernachtung</th></tr></thead>
              <tbody>
                @for (r of store.personTouren.rows(); track r.tour) {
                  <tr tabindex="0" (click)="store.openTour(r.tour)" (keydown.enter)="store.openTour(r.tour)" [class.is-sel]="r.tour === store.tour()">
                    <td>{{ d(r.datum) }}</td><td>{{ r.tourennummer ?? '–' }}</td><td>{{ r.tour_standort }}</td><td>{{ r.personaltyp }}</td>
                    <td>{{ t(r.plan_beginn) }}–{{ t(r.plan_ende) }}</td><td>{{ r.start ?? '–' }} → {{ r.ziel ?? '–' }}</td>
                    <td class="num">{{ m(r.arbeitszeit_min) }}</td><td class="num">{{ m(r.angerechnet_min) }}</td><td>{{ r.rolle ?? '' }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="9" class="ac13-empty">{{ store.personTouren.loading() ? 'Lädt …' : 'Keine besetzte Tour in diesem Monat.' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </app-card>
  `,
})
export class MengeView {
  protected readonly store = inject(Ac13Store);
  protected readonly theme = inject(ThemeService);
  protected readonly c = computed(() => ac13Colors(this.theme.tokens()));
  protected readonly n = (v: number | null) => num(v);
  protected readonly d = (v: string) => dateOnly(v);
  protected readonly t = (v: string | null) => (v ? timeLocal(localMs(v)!) : '–');
  protected readonly m = (v: number | null) => minutes(v);

  /** the month's days (from the model's day dimension via standort_tage, else from the grid) */
  private readonly days = computed(() => {
    const set = new Set<string>();
    for (const r of this.store.standortTage.rows()) set.add(r.datum.slice(0, 10));
    for (const r of this.store.grid.rows()) set.add(r.datum.slice(0, 10));
    const m = this.store.month();
    if (m) {
      const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
      const last = new Date(y, mo, 0).getDate();
      for (let i = 1; i <= last; i++) set.add(isoDay(new Date(y, mo - 1, i).getTime()));
    }
    return [...set].filter((d) => !m || d.startsWith(m)).sort();
  });

  /** persons (rows) and cells - layout only: state per cell, row order, column totals of painted cells */
  private readonly layout = computed(() => {
    const rows = this.store.grid.rows();
    const mode = this.store.mode();
    const days = this.days();
    const dIdx = new Map(days.map((d, i) => [d, i]));
    const per = new Map<string, Person>();
    for (const r of rows) {
      const p = per.get(r.person) ?? { key: r.person, person: personOf(r as unknown as Record<string, unknown>, 'person', 'kennung', mode),
        heimat: r.heimatstandort ?? '(kein Standort)', cells: 0, touren: 0, frei: 0 };
      p.cells++;
      p.touren += r.touren;
      p.frei += (r.ruhe > 0 || r.urlaub > 0) ? 1 : 0;
      per.set(r.person, p);
    }
    // groups by painted days, not by head count: the 30.09 spike puts hundreds of one-day persons into the DL
    // pseudo-depots, which would otherwise open the calendar
    const heimatSize = new Map<string, number>();
    for (const p of per.values()) heimatSize.set(p.heimat, (heimatSize.get(p.heimat) ?? 0) + p.cells);
    const order = [...per.values()].sort((a, b) => (heimatSize.get(b.heimat)! - heimatSize.get(a.heimat)!)
      || a.heimat.localeCompare(b.heimat) || b.cells - a.cells || a.key.localeCompare(b.key));
    const yIdx = new Map(order.map((p, i) => [p.key, order.length - 1 - i]));   // first row at the top
    const cells: { v: [number, number, number]; r: GridRow }[] = [];
    const colTour = days.map(() => 0), colFrei = days.map(() => 0);
    let tour = 0, ruhe = 0, urlaub = 0;
    for (const r of rows) {
      const x = dIdx.get(r.datum.slice(0, 10));
      const y = yIdx.get(r.person);
      if (x == null || y == null) continue;
      const frei = r.ruhe > 0 ? RUHE : r.urlaub > 0 ? URLAUB : 0;
      const state = r.touren > 0 ? (frei ? TOUR_UND_FREI : TOUR) : frei;
      if (!state) continue;
      cells.push({ v: [x, y, state], r });
      if (r.touren > 0) { colTour[x]++; tour++; }
      if (frei) { colFrei[x]++; if (frei === RUHE) ruhe++; else urlaub++; }
    }
    return { order, yIdx, cells, days, colTour, colFrei, totals: { tour, ruhe, urlaub } };
  });
  protected readonly totals = computed(() => this.layout().totals);

  /** band: the model's «übrige + ohne Eintrag» per day, summed over the shown Standorte (never split) */
  private readonly rest = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.store.standortTage.rows()) m.set(r.datum.slice(0, 10), (m.get(r.datum.slice(0, 10)) ?? 0) + r.uebrige_oder_ohne);
    return m;
  });

  protected readonly sel = computed(() => {
    const k = this.store.person();
    return k ? this.layout().order.find((p) => p.key === k) ?? null : null;
  });

  protected readonly height = computed(() => BAND_PX + Math.min(VISIBLE_ROWS, Math.max(8, this.layout().order.length)) * ROW_PX + 64);

  protected readonly answer = computed(() => {
    const { order, totals, days, colTour } = this.layout();
    if (!order.length) return '';
    const peak = colTour.reduce((a, v, i) => (v > colTour[a] ? i : a), 0);
    const heimat = new Map<string, number>();
    for (const p of order) heimat.set(p.heimat, (heimat.get(p.heimat) ?? 0) + 1);
    const top = [...heimat.entries()].sort((a, b) => b[1] - a[1])[0];
    return `${num(order.length)} Personen, ${num(totals.tour)} Tour-Tage und ${num(totals.ruhe + totals.urlaub)} Ruhe- / Urlaubstage; `
      + `die meisten Personen auf Tour am ${dateLong(dayMs(days[peak])!)} (${num(colTour[peak])}). Grösster Personal-Standort: ${top[0]} (${num(top[1])}).`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const { order, cells, days, colTour, colFrei } = this.layout();
    if (!days.length) return null;
    const t = this.theme.tokens();
    const c = this.c();
    const rest = this.rest();
    const focus = this.store.focus();
    const selP = this.store.person();
    const selD = this.store.day();
    const mode = this.store.mode();
    // emphasis only after a tile click that is about the calendar: Abwesenheit dims tours, Übernachtung dims the rest
    const dim = (state: number, ue: boolean) => (focus === 'abwesend' && state === TOUR) || (focus === 'ue' && !ue) ? 0.28 : 1;
    const xLabels = days.map((d) => String(Number(d.slice(8, 10))));
    const weekend = days.map((d) => { const wd = new Date(dayMs(d)!).getDay(); return wd === 0 || wd === 6; });
    const yNames = order.map((p) => p.key).reverse();
    const visible = Math.min(VISIBLE_ROWS, order.length);
    const endPct = order.length ? 100 : 100;
    const startPct = order.length > visible ? 100 - (visible / order.length) * 100 : 0;
    const byKey = new Map(order.map((p) => [p.key, p]));
    const label = (key: string) => {
      const p = byKey.get(key);
      return p?.person ? personText(p.person) : key;
    };
    const firstOfHeimat = new Set<string>();
    let prev = '';
    for (const p of order) { if (p.heimat !== prev) firstOfHeimat.add(p.key); prev = p.heimat; }
    const color = (s: number) => (s === TOUR || s === TOUR_UND_FREI ? c.tour : s === RUHE ? c.ruhe : c.urlaub);
    const ueCells = cells.filter((x) => x.r.uebernachtung > 0);
    const selStyle = { borderColor: t.ink, borderWidth: 1 };
    const urlaubStyle = { decal: urlaubDecal(t.surface) };
    return {
      aria: ariaDecal(),
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: { confine: true },
      grid: [
        { left: 150, right: 18, top: 8, height: BAND_PX - 34 },
        { left: 150, right: 18, top: BAND_PX, bottom: 30 },
      ],
      xAxis: [
        { gridIndex: 0, type: 'category', data: xLabels, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false } },
        {
          gridIndex: 1, type: 'category', data: xLabels, position: 'bottom', axisTick: { show: false }, axisLine: { show: false },
          axisLabel: { interval: 0, fontFamily: FONT_NUM, fontSize: 10.5,
            formatter: (v: string, i: number) => (days[i] === selD ? `{s|${v}}` : weekend[i] ? `{w|${v}}` : v),
            rich: { s: { color: t.ink, fontWeight: 700, fontFamily: FONT_NUM }, w: { color: t.muted, fontFamily: FONT_NUM } } },
          splitArea: { show: true, interval: 0, areaStyle: { color: days.map((_, i) => (weekend[i] ? t.grid : 'transparent')) } },
        },
      ],
      yAxis: [
        { gridIndex: 0, type: 'value', min: 0, splitNumber: 2, axisLabel: { fontSize: 10, color: t.muted }, splitLine: { lineStyle: { color: t.grid } },
          name: 'Personentage', nameLocation: 'middle', nameGap: 44, nameTextStyle: { color: t.muted, fontSize: 10.5 } },
        {
          gridIndex: 1, type: 'category', data: yNames, axisTick: { show: false }, axisLine: { show: false },
          axisLabel: { fontSize: 10.5, fontFamily: FONT_NUM, width: 140, overflow: 'truncate',
            formatter: (v: string) => {
              const p = byKey.get(v);
              const txt = label(v);
              const head = firstOfHeimat.has(v) && p ? `{h|${p.heimat.replace(/^CD - /, '')}} ` : '';
              return v === selP ? `${head}{s|${txt}}` : `${head}${txt}`;
            },
            rich: { s: { color: t.ink, fontWeight: 700, fontFamily: FONT_NUM, fontSize: 10.5 }, h: { color: t.muted, fontSize: 9.5 } } },
        },
      ],
      dataZoom: order.length > visible ? [
        { type: 'slider', yAxisIndex: 1, right: 2, width: 10, start: startPct, end: endPct, showDetail: false, brushSelect: false,
          borderColor: 'transparent', fillerColor: t.grid, handleSize: 0, moveHandleSize: 0 },
        { type: 'inside', yAxisIndex: 1, start: startPct, end: endPct, zoomOnMouseWheel: false, moveOnMouseWheel: 'shift' },
      ] : [],
      // echarts 6: a cartesian heatmap needs a visualMap - the cell state (dimension 2) maps to its category colour
      visualMap: {
        type: 'piecewise', show: false, seriesIndex: 3, dimension: 2,
        pieces: [{ value: TOUR, color: c.tour }, { value: RUHE, color: c.ruhe }, { value: URLAUB, color: c.urlaub }, { value: TOUR_UND_FREI, color: c.tour }],
      },
      series: [
        { name: 'Tour', type: 'bar', stack: 'b', xAxisIndex: 0, yAxisIndex: 0, barCategoryGap: '18%', cursor: 'pointer',
          data: colTour.map((v, i) => ({ value: v, itemStyle: { color: c.tour, opacity: selD == null || days[i] === selD ? 1 : 0.45 } })),
          tooltip: { show: false } },
        { name: 'Ruhe / Urlaub', type: 'bar', stack: 'b', xAxisIndex: 0, yAxisIndex: 0, cursor: 'pointer',
          data: colFrei.map((v, i) => ({ value: v, itemStyle: { color: c.ruhe, opacity: selD == null || days[i] === selD ? 1 : 0.45 } })),
          tooltip: { show: false } },
        { name: 'übrige oder ohne Eintrag', type: 'bar', stack: 'b', xAxisIndex: 0, yAxisIndex: 0, cursor: 'pointer',
          data: days.map((d, i) => ({ value: rest.get(d) ?? 0, itemStyle: { color: c.rest, opacity: selD == null || days[i] === selD ? 1 : 0.45, borderRadius: [2, 2, 0, 0] } })),
          tooltip: {
            trigger: 'item',
            formatter: (p: { dataIndex: number }) => ttHead(dateLong(dayMs(days[p.dataIndex])!))
              + ttRow(c.tour, 'Personen auf Tour', num(colTour[p.dataIndex])) + ttRow(c.ruhe, 'Ruhe- / Urlaubstage', num(colFrei[p.dataIndex]))
              + ttRow(c.rest, 'übrige Abwesenheit oder ohne Eintrag', num(rest.get(days[p.dataIndex]) ?? 0)),
          } },
        {
          name: 'Kalender', type: 'heatmap', xAxisIndex: 1, yAxisIndex: 1, cursor: 'pointer',
          // per-item style only where a cell differs from the series default (selected row, dimmed, Urlaub texture)
          itemStyle: { borderColor: t.surface, borderWidth: 1.5 },
          data: cells.map(({ v, r }) => {
            const op = dim(v[2], r.uebernachtung > 0);
            const sel = r.person === selP;
            if (!sel && op === 1 && v[2] !== URLAUB) return v;
            return { value: v, itemStyle: { opacity: op, ...(sel ? selStyle : {}), ...(v[2] === URLAUB ? urlaubStyle : {}) } };
          }),
          emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } },
          tooltip: {
            formatter: (p: { dataIndex: number }) => {
              const { r, v } = cells[p.dataIndex];
              const who = personOf(r as unknown as Record<string, unknown>, 'person', 'kennung', mode);
              const state = v[2] === TOUR ? 'Tour' : v[2] === RUHE ? 'Ruhetag' : v[2] === URLAUB ? 'Urlaub' : 'Tour und Ruhe / Urlaub';
              return ttHead(`${who ? personText(who) : '–'} · ${dateLong(dayMs(r.datum)!)}`) + ttRow(null, 'Personal-Standort', r.heimatstandort ?? '–')
                + ttRow(color(v[2]), state, r.touren > 0 ? `${num(r.touren)} Tour${r.touren > 1 ? 'en' : ''}` : '')
                + (r.uebernachtung > 0 ? ttRow(c.ue, 'Übernachtungstour', num(r.uebernachtung)) : '')
                + `<div style="opacity:.75;margin-top:4px">${esc('Zeile anklicken: Touren der Person im Monat')}</div>`;
            },
          },
        },
        {
          name: 'Übernachtung', type: 'scatter', xAxisIndex: 1, yAxisIndex: 1, silent: true, symbolSize: 5, z: 5,
          itemStyle: { color: c.ue, borderColor: t.surface, borderWidth: 1 },
          data: ueCells.map(({ v }) => [v[0], v[1]]),
        },
      ],
    };
  });

  protected click(e: { seriesIndex?: number; dataIndex?: number }): void {
    if (e?.dataIndex == null) return;
    if ((e.seriesIndex ?? 0) <= 2) {
      const d = this.days()[e.dataIndex];
      this.store.pickDay(this.store.day() === d ? null : d);
      return;
    }
    const cell = this.layout().cells[e.dataIndex];
    if (!cell) return;
    this.store.pickPerson(this.store.person() === cell.r.person ? null : cell.r.person);
  }
}
