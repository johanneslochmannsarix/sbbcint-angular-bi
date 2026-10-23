import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { HATCH, HATCH_DARK, ac4Colors } from '../data/palette';
import { Ac4Store, monthLabel } from '../data/store';

const h = (min: number | null | undefined) => (min == null ? null : min / 60);

/**
 * View 7 - angerechnete Zeit. Top: per Planmonat the distribution of «Tour angerechnete Zeit» over the tours
 * that carry it (box p25-p75, whiskers p05-p95, from DAX) with the median tour Plandauer of the same tours as a
 * marker. Below, on the same month axis but its own panel (no second y-scale): how many tours carry a value at
 * all - sparse in August / September, ~95 % from October (F3). Right: tours per 30-minute bucket. Nothing is
 * gap-filled; a month without values shows no box.
 */
@Component({
  selector: 'ac4-angerechnet',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wie viel Zeit wird den Touren angerechnet, und wie vollständig ist das?" [q]="[store.anger, store.angerHist]">
      <p class="ac4-answer">{{ answer() }}</p>
      <div class="ac4-split ac4-split-wide">
        <div echarts class="chart" style="height: 380px" [options]="box()!" [theme]="theme.echartsTheme()" (chartClick)="month($any($event))"></div>
        <div echarts class="chart" style="height: 380px" [options]="hist()!" [theme]="theme.echartsTheme()"></div>
      </div>
      <p class="ac4-cover">«Tour angerechnete Zeit» liefert CargoControl je Schicht (shift.eligible_working_time, seit cc 1.35.0 in der Disposition). Für August und September ist sie bei wenigen Touren gefüllt; Lücken werden nicht aufgefüllt. Der Wert steht auf jedem Tourelement und wird je Tour einmal gezählt. Eine Tour-Arbeitszeit gibt es im Export nicht.</p>
    </app-card>
  `,
})
export class AngerechnetView {
  protected readonly store = inject(Ac4Store);
  protected readonly theme = inject(ThemeService);

  private readonly rows = computed(() => this.store.anger.rows().filter((r) => r.planmonat));

  protected readonly answer = computed(() => {
    const rows = this.rows();
    if (!rows.length) return '';
    const m = this.store.month();
    const r = m ? rows.find((x) => x.planmonat === m) : null;
    const tot = rows.reduce((s, x) => s + (x.touren ?? 0), 0);
    const filled = rows.reduce((s, x) => s + (x.touren_anger ?? 0), 0);
    const same = rows.reduce((s, x) => s + (x.gleich_plan ?? 0), 0);
    if (r) {
      return `${monthLabel(m)}: ${pct(r.touren ? (r.touren_anger ?? 0) / r.touren : null, 1)} der Touren tragen eine angerechnete Zeit, im Median ${hours(h(r.a_p50), 1)} ` +
        `bei ${hours(h(r.p_p50), 1)} Plandauer derselben Touren; ${pct(r.touren_anger ? (r.gleich_plan ?? 0) / r.touren_anger : null)} haben genau ihre Plandauer angerechnet.`;
    }
    return `${pct(tot ? filled / tot : null)} aller Touren tragen eine angerechnete Zeit; bei ${pct(filled ? same / filled : null)} davon entspricht sie genau der Plandauer der Tour.`;
  });

  protected readonly box = computed<EChartsCoreOption | null>(() => {
    const rows = this.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac4Colors(this.theme.mode());
    const hatch = this.theme.mode() === 'dark' ? HATCH_DARK : HATCH;
    const ms = rows.map((r) => r.planmonat);
    const sel = this.store.month();
    const fill = rows.map((r) => (r.touren ? (r.touren_anger ?? 0) / r.touren : 0));
    return {
      aria: ariaDecal(),
      animationDuration: 400,
      grid: [
        { left: 44, right: 12, top: 28, height: 200 },
        { left: 44, right: 12, top: 262, height: 80 },
      ],
      xAxis: [
        { type: 'category', gridIndex: 0, data: ms, axisLabel: { show: false } },
        { type: 'category', gridIndex: 1, data: ms, axisLabel: { formatter: (v: string) => monthLabel(v) } },
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, name: 'angerechnet, h je Tour', nameTextStyle: { color: t.muted, align: 'left' }, axisLabel: { formatter: (v: number) => num(v) } },
        { type: 'value', gridIndex: 1, max: 1, name: 'Touren mit Wert', nameTextStyle: { color: t.muted, align: 'left' }, axisLabel: { formatter: (v: number) => pct(v) }, splitNumber: 2 },
      ],
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { dataIndex: number }[]) => {
          const r = rows[ps[0].dataIndex];
          const inc = this.store.incomplete(r.planmonat);
          return ttHead(monthLabel(r.planmonat) + (inc ? ` (${inc})` : '')) +
            ttRow(null, 'Touren mit angerechneter Zeit', `${num(r.touren_anger)} von ${num(r.touren)} (${pct(fill[ps[0].dataIndex], 1)})`) +
            (r.touren_anger ? ttRow(c.plan, 'Median angerechnet', hours(h(r.a_p50), 1)) + ttRow(null, 'Quartile', `${hours(h(r.a_p25), 1)} – ${hours(h(r.a_p75), 1)}`) +
              ttRow(null, 'p05 – p95', `${hours(h(r.a_p05), 1)} – ${hours(h(r.a_p95), 1)}`) + ttRow(t.ink, 'Median Plandauer derselben Touren', hours(h(r.p_p50), 1)) +
              ttRow(null, 'angerechnet = Plandauer (±1 min)', pct(r.touren_anger ? (r.gleich_plan ?? 0) / r.touren_anger : null)) : ttRow(null, 'Verteilung', BLANK));
        },
      },
      series: [
        {
          type: 'boxplot', xAxisIndex: 0, yAxisIndex: 0, name: 'angerechnete Zeit', boxWidth: [10, 34], cursor: 'pointer',
          itemStyle: { color: c.seq[1], borderColor: c.plan, borderWidth: 1.5 },
          data: rows.map((r) => ({
            value: r.touren_anger ? [h(r.a_p05), h(r.a_p25), h(r.a_p50), h(r.a_p75), h(r.a_p95)] : [],
            itemStyle: { opacity: !sel || sel === r.planmonat ? 1 : 0.4 },
          })),
        },
        {
          type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, name: 'Median Plandauer', symbol: 'diamond', symbolSize: 10,
          itemStyle: { color: t.ink, borderColor: t.surface, borderWidth: 1 },
          data: rows.map((r) => (r.touren_anger ? h(r.p_p50) : null)),
        },
        {
          type: 'bar', xAxisIndex: 1, yAxisIndex: 1, name: 'Touren mit angerechneter Zeit', barMaxWidth: 34, cursor: 'pointer',
          data: rows.map((r, i) => ({
            value: fill[i],
            itemStyle: { color: c.plan, borderRadius: [4, 4, 0, 0], opacity: !sel || sel === r.planmonat ? 1 : 0.4, decal: fill[i] < 0.5 ? hatch : undefined },
          })),
          label: { show: true, position: 'top', color: t.ink2, fontSize: 11, formatter: (p: { value: number }) => pct(p.value) },
        },
      ],
    };
  });

  protected readonly hist = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.angerHist.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac4Colors(this.theme.mode());
    const ms = [...new Set(rows.map((r) => r.planmonat))].sort();
    const lo = Math.min(...rows.map((r) => r.bucket));
    const hi = Math.max(...rows.map((r) => r.bucket));
    const buckets = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const max = Math.max(...rows.map((r) => r.touren));
    const lbl = (b: number) => (b >= 48 ? '≥ 24 h' : `${num(b / 2, 1)} h`);
    return {
      aria: ariaDecal(),
      grid: { left: 4, right: 8, top: 28, bottom: 4, outerBounds: { left: 4, right: 8, top: 28, bottom: 4 } },
      title: { text: 'Touren je 30 Minuten', left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 600, color: t.ink2 } },
      xAxis: { type: 'category', data: ms.map((m) => monthLabel(m)), splitArea: { show: false } },
      yAxis: { type: 'category', data: buckets.map(lbl), axisLabel: { interval: 3 } },
      visualMap: { show: false, min: 0, max, inRange: { color: c.seq.slice(0, 7) } },
      tooltip: {
        confine: true,
        formatter: (p: { data: [number, number, number] }) => ttHead(`${ms[p.data[0]] ? monthLabel(ms[p.data[0]]) : ''}, ${lbl(buckets[p.data[1]])} bis ${lbl(buckets[p.data[1]] + 1)}`) + ttRow(null, 'Touren', num(p.data[2])),
      },
      series: [{
        type: 'heatmap', itemStyle: { borderColor: t.surface, borderWidth: 1 },
        data: rows.map((r) => [ms.indexOf(r.planmonat), r.bucket - lo, r.touren]),
      }],
    };
  });

  protected month(e: { dataIndex?: number }): void {
    const r = this.rows()[e?.dataIndex ?? -1];
    if (r) this.store.pickMonth(this.store.month() === r.planmonat ? null : r.planmonat);
  }
}
