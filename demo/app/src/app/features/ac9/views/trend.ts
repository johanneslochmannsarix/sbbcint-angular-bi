import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, legendTop, ttHead, ttRow } from '../../../shared/chart-opts';
import { ChartGroup } from '../../../shared/connect';
import { ac9Colors, hatch } from '../data/palette';
import { Ac9Store, monthLabel } from '../data/store';
import { RuleNote } from './rule-note';

/**
 * View 3 - the month trend: billable hours per Abrechnungsmonat stacked AÜ / DL, and the reported tours on their
 * own axis in a second panel under it (one shared month axis, linked pointer; two measures of different scale
 * never share one y-axis). The selected months are marked; a click on a month picks it for the whole page.
 */
@Component({
  selector: 'ac9-trend',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, ChartGroup, RuleNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wie entwickeln sich Stunden und Touren?" [q]="store.monate">
      <p class="ac9-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="330" [options]="options() ?? {}" [theme]="theme.echartsTheme()" chartGroup="ac9-monate"
           (chartClick)="click($any($event))" aria-label="Abrechenbare Stunden je Monat (AÜ und DL gestapelt), darunter Touren mit IST je Monat"></div>
      <ac9-rule [keys]="['monat']"><p>Der laufende Monat ist schraffiert: Rückmeldungen kommen noch.</p></ac9-rule>
    </app-card>
  `,
})
export class Trend {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);

  protected readonly answer = computed(() => {
    const tot = this.store.monate.rows().filter((r) => r.ga_total && !this.store.running(r.year_month_ist));
    if (tot.length < 2) return '';
    const top = tot.reduce((a, b) => (b.netto_h > a.netto_h ? b : a));
    const last = tot[tot.length - 1];
    return `Der stärkste Monat war ${monthLabel(top.year_month_ist, true)} mit ${hours(top.netto_h)} in ${num(top.touren)} Touren; ` +
      `zuletzt abgeschlossen: ${monthLabel(last.year_month_ist, true)} mit ${hours(last.netto_h)}.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const months = this.store.months();
    if (!months.length) return null;
    const rows = this.store.monate.rows();
    const t = this.theme.tokens();
    const c = ac9Colors(this.theme.mode());
    const mode = this.theme.mode();
    const val = (m: string, ga: string) => rows.find((r) => !r.ga_total && r.year_month_ist === m && r.geschaeftsart === ga)?.netto_h ?? 0;
    const tot = (m: string) => rows.find((r) => r.ga_total && r.year_month_ist === m);
    const bars = (['AÜ', 'DL'] as const).map((ga, i) => ({
      id: `tr-${ga}`, name: ga, type: 'bar', stack: 'h', xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 22, cursor: 'pointer',
      itemStyle: { color: ga === 'AÜ' ? c.aue : c.dl },
      data: months.map((m) => ({
        value: val(m, ga), name: m,
        itemStyle: {
          color: ga === 'AÜ' ? c.aue : c.dl, borderRadius: i === 1 ? [4, 4, 0, 0] : 0, opacity: this.store.inRange(m) ? 1 : 0.4,
          decal: this.store.running(m) ? hatch(mode) : undefined,
        },
      })),
    }));
    return {
      animationDuration: 400,
      aria: ariaDecal(),
      legend: { ...legendTop(t), data: ['AÜ', 'DL', 'Touren mit IST'] },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 8, right: 12, top: 30, height: 178, outerBounds: { left: 8, right: 12, top: 30, bottom: 120 } },
        { left: 8, right: 12, top: 236, height: 64, outerBounds: { left: 8, right: 12, top: 236, bottom: 30 } },
      ],
      xAxis: [
        { gridIndex: 0, type: 'category', data: months, axisLabel: { show: false }, axisTick: { show: false } },
        { gridIndex: 1, type: 'category', data: months, axisLabel: { color: t.muted, fontSize: 10.5, formatter: (m: string) => monthLabel(m) } },
      ],
      yAxis: [
        { gridIndex: 0, type: 'value', name: 'Stunden', nameTextStyle: { color: t.muted, align: 'left' }, splitLine: { lineStyle: { color: t.grid } },
          axisLabel: { color: t.muted, formatter: (x: number) => `${num(x / 1000)}k` } },
        { gridIndex: 1, type: 'value', name: 'Touren', nameTextStyle: { color: t.muted, align: 'left' }, splitNumber: 2, splitLine: { lineStyle: { color: t.grid } },
          axisLabel: { color: t.muted, formatter: (x: number) => num(x) } },
      ],
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: (ps: { name: string }[]) => {
          const m = ps[0]?.name;
          const r = tot(m);
          return ttHead(monthLabel(m, true) + (this.store.running(m) ? ' (läuft noch)' : '')) +
            ttRow(c.aue, 'AÜ abrechenbar', hours(val(m, 'AÜ'))) + ttRow(c.dl, 'DL abrechenbar', hours(val(m, 'DL'))) +
            ttRow(null, 'Summe', hours(r?.netto_h)) + ttRow(t.ink, 'Touren mit IST', num(r?.touren));
        },
      },
      series: [
        ...bars,
        {
          id: 'tr-touren', name: 'Touren mit IST', type: 'line', xAxisIndex: 1, yAxisIndex: 1, symbol: 'circle', symbolSize: 6,
          data: months.map((m) => tot(m)?.touren ?? 0),
          lineStyle: { color: t.ink, width: 2 }, itemStyle: { color: t.ink, borderColor: t.surface, borderWidth: 2 },
          endLabel: { show: true, color: t.ink2, formatter: (p: { value: number }) => num(p.value) },
        },
      ],
    };
  });

  protected click(e: { name?: string; event?: { event?: MouseEvent } }): void {
    if (e?.name) this.store.pickMonth(e.name, !!e.event?.event?.shiftKey);
  }
}
