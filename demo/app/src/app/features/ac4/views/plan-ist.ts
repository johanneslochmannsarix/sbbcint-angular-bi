import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac4Colors, fahrenColor } from '../data/palette';
import { Ac4Store, monthLabel } from '../data/store';
import { PlanIstRow } from '../data/types';

const CELL = 10;               // density cell, minutes
const X: [number, number] = [-120, 240];
const Y: [number, number] = [-90, 120];

const signed = (v: number | null | undefined) => (v == null ? BLANK : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v))} min`);

/**
 * View 4 - Plan und Ist. Every element WITH Ist (both deviations present, the report's «Elemente mit Ist») as a
 * point: x = Ist-Beginn − Plan-Beginn, y = Istdauer − Plandauer (minutes), colour = Fahren, with a 10-minute
 * density layer underneath and the ±15-min band the report's shares use. A brush selects a region: the panel
 * counts the brushed points per Tätigkeit and Tourstandort. A point opens its tour. The month strip shows how
 * many past elements carry Ist at all - the comparison rests on that share, never on a total (F4).
 */
@Component({
  selector: 'ac4-plan-ist',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wo weicht das Ist vom Plan ab, und wie oft wird es überhaupt erfasst?" [q]="[store.planIst, store.monate]"
      emptyNote="Unter diesem Filter hat kein Tourelement Ist-Beginn und Ist-Ende.">
      <p class="ac4-answer">{{ answer() }}</p>
      <div class="ac4-split ac4-split-wide">
        <div>
          <div echarts class="chart" style="height: 420px" [options]="scatter()!" [theme]="theme.echartsTheme()"
               (chartBrushEnd)="brushed($any($event))" (chartClick)="open($any($event))"></div>
          <div class="legend-inline ac4-legend">
            <span><i class="key" [style.background]="c().fahren"></i>Fahren = ja</span>
            <span><i class="key" [style.background]="c().plan"></i>Fahren = nein</span>
            <span><i class="key" [style.background]="c().neutral"></i>ohne Tätigkeit</span>
            <span class="muted">Band = ±15 min · Rechteck-Werkzeug oben rechts markiert einen Bereich · Punkt öffnet die Tour</span>
          </div>
        </div>
        <div class="ac4-side">
          <h3 class="ac4-h3">Ist-Erfassung je Planmonat (vergangene Elemente)</h3>
          <div echarts class="chart" style="height: 150px" [options]="strip()!" [theme]="theme.echartsTheme()"></div>
          <h3 class="ac4-h3">{{ brushTitle() }}</h3>
          <table class="tbl ac4-tbl">
            <thead><tr><th>Tätigkeit</th><th class="r">Elemente</th><th class="r">Median Beginn</th></tr></thead>
            <tbody>
              @for (r of byTaet(); track r.name) { <tr><td>{{ r.name }}</td><td class="r">{{ r.n }}</td><td class="r">{{ r.med }}</td></tr> }
            </tbody>
          </table>
          <table class="tbl ac4-tbl">
            <thead><tr><th>Tourstandort</th><th class="r">Elemente</th><th class="r">Median Beginn</th></tr></thead>
            <tbody>
              @for (r of byStandort(); track r.name) { <tr><td>{{ r.name }}</td><td class="r">{{ r.n }}</td><td class="r">{{ r.med }}</td></tr> }
            </tbody>
          </table>
        </div>
      </div>
      <p class="ac4-cover">{{ cover() }}</p>
    </app-card>
  `,
})
export class PlanIstView {
  protected readonly store = inject(Ac4Store);
  protected readonly theme = inject(ThemeService);
  protected readonly c = computed(() => ac4Colors(this.theme.mode()));

  private readonly cur = computed(() => {
    const m = this.store.month();
    const rows = this.store.monate.rows();
    return (m ? rows.find((r) => r.planmonat === m) : rows.find((r) => r.ist_gesamt)) ?? null;
  });

  protected readonly answer = computed(() => {
    const r = this.cur();
    if (!r || !r.elemente_mit_ist) return '';
    return `${pct(r.beginn_spaeter, 1)} der Elemente mit Ist beginnen mehr als 15 min später als geplant, ${pct(r.beginn_frueher, 1)} früher; ` +
      `die Dauer liegt bei ${pct(r.dauer_innerhalb, 1)} innerhalb ±15 min (${monthLabel(this.store.month())}, ${num(r.elemente_mit_ist)} Elemente).`;
  });
  protected readonly cover = computed(() => {
    const r = this.cur();
    if (!r) return '';
    return `Gemessen auf ${num(r.elemente_mit_ist)} von ${num(r.elemente_vergangen)} vergangenen Elementen (${pct(r.ist_erfassung, 1)}): ` +
      `CargoControl meldet Ist fast nur für Fahrten, abgeschlossene Schichten tragen keins (SAX-32). Plan- und Istdauer derselben Elemente: ${hours(r.plan_mit_ist_h, 0)} gegen ${hours(r.ist_mit_ist_h, 0)}. ` +
      `Tour-Ist ist aus den Elementen abgeleitet (${num(r.touren_ist)} Touren mit Ist, davon ${num(r.touren_ist_alle_fahr)} mit Ist auf allen Fahrelementen) und beschreibt den rückgemeldeten Zeitraum, nicht Dienstbeginn und -ende. Eine Tour-Arbeitszeit liefert der Export nicht.`;
  });

  /** density binning of the returned deviations (layout only) */
  private readonly cells = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.store.planIst.rows()) {
      const x = Math.floor(r.abw_beginn_min / CELL) * CELL;
      const y = Math.floor(r.abw_dauer_min / CELL) * CELL;
      if (x < X[0] || x >= X[1] || y < Y[0] || y >= Y[1]) continue;
      const k = `${x}|${y}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].map(([k, n]) => [...k.split('|').map(Number), n] as [number, number, number]);
  });

  protected readonly scatter = computed<EChartsCoreOption | null>(() => {
    if (!this.store.planIst.rows().length) return null;
    const t = this.theme.tokens();
    const c = this.c();
    const cells = this.cells();
    const maxN = Math.max(1, ...cells.map((x) => x[2]));
    const groups: [string | null, string][] = [['ja', 'Fahren = ja'], ['nein', 'Fahren = nein'], [null, 'ohne Tätigkeit']];
    return {
      aria: ariaDecal(),
      animation: false,
      grid: { left: 8, right: 24, top: 36, bottom: 8, outerBounds: { left: 8, right: 24, top: 36, bottom: 8 } },
      toolbox: { right: 8, top: 0, itemSize: 14, feature: { brush: { type: ['rect', 'clear'], title: { rect: 'Bereich markieren', clear: 'Markierung löschen' } } } },
      brush: { xAxisIndex: 0, yAxisIndex: 0, throttleType: 'debounce', throttleDelay: 200, brushStyle: { borderColor: t.ink, color: 'rgba(120,120,120,0.08)' },
        outOfBrush: { opacity: 0.08 }, seriesIndex: [1, 2, 3] },
      xAxis: { type: 'value', min: X[0], max: X[1], name: 'Beginn: Ist − Plan (min)', nameLocation: 'middle', nameGap: 26, splitLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: 'value', min: Y[0], max: Y[1], name: 'Dauer: Ist − Plan (min)', nameLocation: 'middle', nameGap: 36, splitLine: { lineStyle: { color: t.grid } } },
      dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }, { type: 'inside', yAxisIndex: 0, filterMode: 'none' }],
      tooltip: {
        confine: true,
        formatter: (p: { seriesIndex: number; data: unknown }) => {
          if (p.seriesIndex === 0) {
            const [x, y, n] = p.data as [number, number, number];
            return ttHead(`Beginn ${signed(x)}…${signed(x + CELL)}, Dauer ${signed(y)}…${signed(y + CELL)}`) + ttRow(null, 'Elemente', num(n));
          }
          const r = this.rowAt(p.seriesIndex, (p as unknown as { dataIndex: number }).dataIndex);
          if (!r) return '';
          return ttHead(`${r.taetigkeit ?? 'ohne Tätigkeit'} · ${r.tourstandort ?? ''}`) + ttRow(null, 'Beginn Ist − Plan', signed(r.abw_beginn_min)) +
            ttRow(null, 'Dauer Ist − Plan', signed(r.abw_dauer_min)) + ttRow(null, 'Plandauer', `${num(r.plandauer_min)} min`) +
            ttRow(null, 'Planmonat', monthLabel(r.planmonat)) + '<div style="color:' + t.muted + ';margin-top:4px">Klick öffnet die Tour</div>';
        },
      },
      series: [
        {
          type: 'custom', name: 'Dichte', silent: false, z: 1,
          data: cells,
          renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
            const [x0, y1] = api.coord([api.value(0), api.value(1) + CELL]);
            const [w, h] = api.size([CELL, CELL]);
            const k = Math.min(c.seq.length - 1, Math.floor((Math.sqrt(api.value(2)) / Math.sqrt(maxN)) * (c.seq.length - 1)));
            return { type: 'rect', shape: { x: x0, y: y1, width: w, height: h }, style: { fill: c.seq[k], opacity: 0.55 } };
          },
          markArea: {
            silent: true, itemStyle: { color: 'transparent', borderColor: t.ink2, borderWidth: 1, borderType: 'dashed' },
            data: [[{ xAxis: -15, yAxis: -15 }, { xAxis: 15, yAxis: 15 }]],
          },
        },
        ...groups.map(([f, name], gi) => ({
          type: 'scatter', name, large: true, largeThreshold: 2000, symbolSize: 4, z: 3, cursor: 'pointer',
          itemStyle: { color: fahrenColor(c, f), opacity: 0.6 },
          data: this.byGroup()[gi].map((r) => [r.abw_beginn_min, r.abw_dauer_min]),
        })),
      ],
    };
  });

  protected readonly strip = computed<EChartsCoreOption | null>(() => {
    const months = this.store.monate.rows().filter((r) => !r.ist_gesamt && r.planmonat && (r.elemente_vergangen ?? 0) > 0);
    if (!months.length) return null;
    const t = this.theme.tokens();
    const c = this.c();
    const m = this.store.month();
    return {
      aria: ariaDecal(),
      grid: { left: 4, right: 4, top: 8, bottom: 4, outerBounds: { left: 4, right: 4, top: 8, bottom: 4 } },
      xAxis: { type: 'category', data: months.map((r) => monthLabel(r.planmonat)) },
      yAxis: { type: 'value', max: 0.1, axisLabel: { formatter: (v: number) => pct(v) } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { dataIndex: number }[]) => {
          const r = months[ps[0].dataIndex];
          const inc = this.store.incomplete(r.planmonat);
          return ttHead(monthLabel(r.planmonat) + (inc ? ` (${inc})` : '')) + ttRow(c.ist, 'Ist-Erfassungsgrad', pct(r.ist_erfassung, 1)) +
            ttRow(null, 'Elemente mit Ist', num(r.elemente_mit_ist)) + ttRow(null, 'vergangene Elemente', num(r.elemente_vergangen)) +
            ttRow(null, 'Ist gegenüber Plan', pct(r.ist_zu_plan, 1));
        },
      },
      series: [{
        type: 'bar', barMaxWidth: 26,
        data: months.map((r) => ({ value: r.ist_erfassung, itemStyle: { color: c.ist, borderRadius: [4, 4, 0, 0], opacity: (!m || m === r.planmonat ? 1 : 0.4) * (this.store.incomplete(r.planmonat) ? 0.6 : 1) } })),
        label: { show: true, position: 'top', color: t.ink2, fontSize: 11, formatter: (p: { value: number }) => pct(p.value, 1) },
      }],
    };
  });

  /** the rows inside the brush (a filter of returned rows), else all */
  private readonly picked = computed(() => {
    const b = this.store.brush();
    const rows = this.store.planIst.rows();
    if (!b) return rows;
    return rows.filter((r) => r.abw_beginn_min >= b.beginn[0] && r.abw_beginn_min <= b.beginn[1] && r.abw_dauer_min >= b.dauer[0] && r.abw_dauer_min <= b.dauer[1]);
  });
  protected readonly brushTitle = computed(() => {
    const b = this.store.brush();
    const n = this.picked().length;
    return b ? `Markiert: ${num(n)} Elemente (Beginn ${signed(Math.round(b.beginn[0]))}…${signed(Math.round(b.beginn[1]))}, Dauer ${signed(Math.round(b.dauer[0]))}…${signed(Math.round(b.dauer[1]))})`
      : `Alle ${num(n)} Elemente mit Ist`;
  });
  private group(key: (r: PlanIstRow) => string): { name: string; n: string; med: string }[] {
    const m = new Map<string, number[]>();
    for (const r of this.picked()) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r.abw_beginn_min);
    return [...m].sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([name, xs]) => {
      xs.sort((a, b) => a - b);
      return { name, n: num(xs.length), med: signed(xs[Math.floor((xs.length - 1) / 2)]) };
    });
  }
  /** counts and medians of the brushed / returned deviations (quantiles of returned values, layout) */
  protected readonly byTaet = computed(() => this.group((r) => r.taetigkeit ?? 'ohne Tätigkeit'));
  protected readonly byStandort = computed(() => this.group((r) => r.tourstandort ?? '–'));

  protected brushed(e: { areas?: { coordRange?: number[][] }[] }): void {
    const a = e?.areas?.[0]?.coordRange;
    this.store.brush.set(a && a.length === 2 ? { beginn: [a[0][0], a[0][1]], dauer: [a[1][0], a[1][1]] } : null);
  }

  /** scatter rows per Fahren group, in series order 1..3 (series 0 is the density layer) */
  private readonly byGroup = computed(() => {
    const rows = this.store.planIst.rows();
    return [rows.filter((r) => r.fahren === 'ja'), rows.filter((r) => r.fahren === 'nein'), rows.filter((r) => r.fahren !== 'ja' && r.fahren !== 'nein')];
  });
  private rowAt(seriesIndex: number | undefined, dataIndex: number | undefined): PlanIstRow | null {
    if (!seriesIndex || dataIndex == null) return null;
    return this.byGroup()[seriesIndex - 1]?.[dataIndex] ?? null;
  }

  protected open(e: { seriesIndex?: number; dataIndex?: number }): void {
    const r = this.rowAt(e?.seriesIndex, e?.dataIndex);
    if (!r || !r.tour_id || !r.depot_sk) return;
    this.store.pickStandort(r.depot_sk);
    if (r.planmonat) this.store.month.set(r.planmonat);
    this.store.tour.set(r.tour_id);
    document.getElementById('ac4-tour')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
