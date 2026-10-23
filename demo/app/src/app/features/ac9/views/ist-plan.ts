import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { dateTimeLU, hours, localMs, num } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac9Colors, gaColor } from '../data/palette';
import { Ac9Store } from '../data/store';
import { PunktRow } from '../data/types';
import { RuleNote } from './rule-note';

const GAS = ['AÜ', 'DL'] as const;

/** quantile of sorted values (type 7, as PERCENTILEX.INC) - layout only */
function q(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (h - lo);
}
/** a stable jitter per tour from its pseudo-id (layout only) */
function jitter(id: string): number {
  let x = 0;
  for (let i = 2; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) % 1000;
  return (x / 1000 - 0.5) * 0.5;
}

/**
 * View 5 - IST against PLAN. Per Geschäftsart the distribution of the gap «IST-Dauer brutto − Plandauer» of every
 * reported tour in the selected months: a box plot (quartiles of the returned values, layout) with every tour as a
 * point beside it (large mode from 2 000 points). PLAN is context only - this view explains, it bills nothing. A
 * point opens its tour.
 */
@Component({
  selector: 'ac9-ist-plan',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, RuleNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wo weichen IST und Plan voneinander ab?" [q]="store.punkte" sub="IST-Dauer brutto minus Plandauer je Tour; Plan ist Kontext"
              emptyNote="Keine zurückgemeldete Tour in dieser Auswahl.">
      <p class="ac9-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="340" [options]="options() ?? {}" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))" aria-label="Verteilung der Abweichung IST minus Plan je Geschäftsart, Punkt anklicken öffnet die Tour"></div>
      <ac9-rule [keys]="['ist']" />
    </app-card>
  `,
})
export class IstPlan {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);

  private readonly byGa = computed(() => {
    const out = new Map<string, { rows: PunktRow[]; sorted: number[] }>();
    for (const ga of GAS) {
      const rows = this.store.punkte.rows().filter((r) => r.geschaeftsart === ga && r.gap_h != null);
      out.set(ga, { rows, sorted: rows.map((r) => r.gap_h!).sort((a, b) => a - b) });
    }
    return out;
  });

  protected readonly answer = computed(() => {
    const parts: string[] = [];
    for (const ga of GAS) {
      const s = this.byGa().get(ga)!.sorted;
      if (!s.length) continue;
      const longer = s.filter((x) => x > 0).length;
      parts.push(`${ga}: Median ${signed(q(s, 0.5))}, die mittlere Hälfte ${signed(q(s, 0.25))} bis ${signed(q(s, 0.75))}, ${num(longer)} von ${num(s.length)} Touren länger als geplant`);
    }
    return parts.length ? `${parts.join('; ')}.` : '';
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const g = this.byGa();
    const present = GAS.filter((ga) => g.get(ga)!.rows.length);
    if (!present.length) return null;
    const t = this.theme.tokens();
    const c = ac9Colors(this.theme.mode());
    const n = present.reduce((s, ga) => s + g.get(ga)!.rows.length, 0);
    const large = n > 2000;
    const box = present.map((ga, i) => {
      const s = g.get(ga)!.sorted;
      return { value: [q(s, 0.05), q(s, 0.25), q(s, 0.5), q(s, 0.75), q(s, 0.95)], itemStyle: { color: 'transparent', borderColor: gaColor(c, ga), borderWidth: 2 }, name: ga, idx: i };
    });
    const pts = present.map((ga, i) => ({
      id: `ip-${ga}`, name: ga, type: 'scatter', large, largeThreshold: 2000, symbolSize: large ? 3 : 5, cursor: 'pointer',
      itemStyle: { color: gaColor(c, ga), opacity: 0.45 },
      data: g.get(ga)!.rows.map((r) => ({ value: [i + 0.02 + Math.abs(jitter(r.tour)) * 1.2, r.gap_h], tour: r.tour })),
      tooltip: {
        formatter: (p: { dataIndex: number }) => {
          const r = g.get(ga)!.rows[p.dataIndex];
          return ttHead(r.dor_name ?? '') + ttRow(gaColor(c, ga), 'IST-Beginn', dateTimeLU(localMs(r.ist_start))) +
            ttRow(null, 'IST brutto', hours(r.ist_dauer_h, 2)) + ttRow(null, 'Plandauer (Kontext)', hours(r.plan_dauer_h, 2)) +
            ttRow(null, 'IST − Plan', signed(r.gap_h)) + '<div style="color:' + t.muted + '">anklicken: Tour öffnen</div>';
        },
      },
    }));
    return {
      animation: !large,
      aria: ariaDecal(),
      grid: { left: 8, right: 78, top: 16, bottom: 8, outerBounds: { left: 8, right: 78, top: 16, bottom: 8 } },
      xAxis: {
        type: 'value', min: -0.5, max: present.length - 0.5, interval: 0.5, splitLine: { show: false },
        axisLabel: { color: t.ink2, formatter: (v: number) => (Number.isInteger(v) && present[v] ? `${present[v]}  (${num(g.get(present[v])!.rows.length)} Touren)` : '') },
      },
      yAxis: {
        type: 'value', name: 'h', nameTextStyle: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.muted, formatter: (v: number) => signed(v, 0) },
      },
      dataZoom: [{ type: 'inside', yAxisIndex: 0, filterMode: 'none' }],
      tooltip: { trigger: 'item', confine: true },
      series: [
        {
          id: 'ip-box', type: 'boxplot', data: box.map((b) => ({ value: [b.idx - 0.2, ...b.value], itemStyle: b.itemStyle, name: b.name })),
          encode: { x: 0, y: [1, 2, 3, 4, 5] }, boxWidth: [18, 38], silent: false,
          markLine: { silent: true, symbol: 'none', lineStyle: { color: t.ink2, type: 'solid', width: 1 }, label: { color: t.muted, formatter: 'wie geplant' }, data: [{ yAxis: 0 }] },
          tooltip: {
            formatter: (p: { name: string; value: number[] }) => ttHead(`${p.name}: IST − Plan`) +
              ttRow(null, '95. Perzentil', signed(p.value[5])) + ttRow(null, 'oberes Quartil', signed(p.value[4])) +
              ttRow(null, 'Median', signed(p.value[3])) + ttRow(null, 'unteres Quartil', signed(p.value[2])) + ttRow(null, '5. Perzentil', signed(p.value[1])),
          },
        },
        ...pts,
      ],
    };
  });

  protected click(e: { data?: { tour?: string } }): void {
    if (e?.data?.tour) this.store.openTour(e.data.tour);
  }
}

function signed(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v), digits)} h`;
}
