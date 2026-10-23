import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, legendTop, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac9Colors, gaColor } from '../data/palette';
import { Ac9Store } from '../data/store';
import { RuleNote } from './rule-note';

const BIN = 0.5;
const CAP = 20;          // the last bin collects everything from 20 h (Step 2: max 36 h)

interface Bin { x0: number; x1: number; n: Record<string, number> }

/**
 * View 6 - Schwellwerte. The shift-length distribution (IST-Dauer brutto per reported tour, the basis of the
 * thresholds) as a histogram in half hours, stacked AÜ / DL; 12 h and 14 h are marked as the thresholds in force,
 * 10 h as «ab 2027». The bins are layout (counted from the returned tours); the hit counts in the answer and the
 * figures are the model's [Anzahl Touren über 10 / 12 / 14 h].
 */
@Component({
  selector: 'ac9-schwellen',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, RuleNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .sw-figs { display: flex; gap: 28px; flex-wrap: wrap; margin: 0 0 6px; }
    .sw-figs div { display: flex; flex-direction: column; }
    .sw-figs b { font: 600 22px/1.1 var(--ac9-num); color: var(--ink); }
    .sw-figs span { font-size: 12px; color: var(--muted); }
  `],
  template: `
    <app-card heading="Welche Touren überschreiten die Schwellwerte?" [q]="[store.punkte, store.kpi]" sub="IST-Dauer brutto je zurückgemeldeter Tour">
      <p class="ac9-answer">{{ answer() }}</p>
      @if (store.kpiTotal(); as k) {
        <div class="sw-figs">
          <div><b>{{ num(k.ue12) }}</b><span>über 12 h</span></div>
          <div><b>{{ num(k.ue14) }}</b><span>über 14 h</span></div>
          <div><b>{{ num(k.ue10) }}</b><span>über 10 h, gilt ab 2027</span></div>
        </div>
      }
      <div echarts class="chart" [style.height.px]="280" [options]="options() ?? {}" [theme]="theme.echartsTheme()"
           aria-label="Verteilung der Schichtlänge in halben Stunden, AÜ und DL gestapelt, Schwellwerte 12 und 14 Stunden markiert"></div>
      <ac9-rule [keys]="['schwelle']" />
    </app-card>
  `,
})
export class Schwellen {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);
  protected readonly num = num;

  private readonly bins = computed<Bin[]>(() => {
    const bins: Bin[] = [];
    for (let x = 0; x < CAP; x += BIN) bins.push({ x0: x, x1: x + BIN, n: { 'AÜ': 0, DL: 0 } });
    bins.push({ x0: CAP, x1: CAP + BIN * 2, n: { 'AÜ': 0, DL: 0 } });
    for (const r of this.store.punkte.rows()) {
      const h = r.ist_dauer_h;
      if (h == null || !r.geschaeftsart) continue;
      const i = h >= CAP ? bins.length - 1 : Math.max(0, Math.floor(h / BIN - 1e-9));
      bins[i].n[r.geschaeftsart] = (bins[i].n[r.geschaeftsart] ?? 0) + 1;
    }
    return bins;
  });

  protected readonly answer = computed(() => {
    const k = this.store.kpiTotal();
    if (!k || !k.touren) return '';
    return `${num(k.ue12)} der ${num(k.touren)} zurückgemeldeten Touren dauerten über 12 h (${pct(k.ue12 / k.touren, 1)}), ${num(k.ue14)} über 14 h. ` +
      `Mit der 10-h-Schwelle ab 2027 wären es ${num(k.ue10)}.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const bins = this.bins();
    if (!this.store.punkte.rows().length) return null;
    const t = this.theme.tokens();
    const c = ac9Colors(this.theme.mode());
    const series = (['AÜ', 'DL'] as const).map((ga, gi) => ({
      id: `sw-${ga}`, name: ga, type: 'custom',
      data: bins.map((b) => [b.x0, b.x1, gi === 0 ? 0 : b.n['AÜ'], (gi === 0 ? 0 : b.n['AÜ']) + b.n[ga], b.n[ga]]),
      encode: { x: [0, 1], y: [2, 3] },
      itemStyle: { color: gaColor(c, ga) },
      renderItem: (_p: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[] }) => {
        if (!api.value(4)) return null;
        const a = api.coord([api.value(0), api.value(3)]);
        const b = api.coord([api.value(1), api.value(2)]);
        return { type: 'rect', shape: { x: a[0] + 1, y: a[1], width: Math.max(1, b[0] - a[0] - 2), height: Math.max(0, b[1] - a[1] - (gi === 0 ? 0 : 1)) }, style: { fill: gaColor(c, ga) } };
      },
      markLine: gi === 0 ? {
        silent: true, symbol: 'none',
        data: [
          { xAxis: 12, lineStyle: { color: t.ink, width: 1.5, type: 'solid' }, label: { formatter: '12 h', color: t.ink, position: 'end' } },
          { xAxis: 14, lineStyle: { color: t.ink, width: 1.5, type: 'solid' }, label: { formatter: '14 h', color: t.ink, position: 'end' } },
          { xAxis: 10, lineStyle: { color: t.muted, width: 1, type: [4, 4] }, label: { formatter: '10 h ab 2027', color: t.muted, position: 'end' } },
        ],
      } : undefined,
    }));
    return {
      animationDuration: 400,
      aria: ariaDecal(),
      legend: legendTop(t),
      grid: { left: 8, right: 24, top: 34, bottom: 6, outerBounds: { left: 8, right: 24, top: 34, bottom: 6 } },
      xAxis: { type: 'value', min: 0, max: CAP + BIN * 2, interval: 2, splitLine: { show: false },
        axisLabel: { color: t.muted, formatter: (v: number) => (v >= CAP ? `${CAP}+ h` : `${v} h`) } },
      yAxis: { type: 'value', name: 'Touren', nameTextStyle: { color: t.muted, align: 'left' }, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: { value: number[] }) => {
          const b = bins.find((x) => x.x0 === p.value[0]);
          if (!b) return '';
          const label = b.x0 >= CAP ? `ab ${CAP} h` : `${num(b.x0, 1)} – ${num(b.x1, 1)} h`;
          return ttHead(`Schichtlänge ${label}`) + ttRow(c.aue, 'AÜ', num(b.n['AÜ'])) + ttRow(c.dl, 'DL', num(b.n['DL']));
        },
      },
      series,
    };
  });
}
