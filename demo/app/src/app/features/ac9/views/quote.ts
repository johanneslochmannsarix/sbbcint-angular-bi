import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, legendTop, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac9Colors } from '../data/palette';
import { Ac9Store, monthLabel } from '../data/store';
import { RuleNote } from './rule-note';

/**
 * View 4 - the Rückmeldequote per PLANNED month and Geschäftsart, the model's [IST-Quote %] (per tour, never per
 * element). Shown neutrally: the same colours as everywhere, no highlight, no target line - the low AÜ quote is a
 * parked finding (Johannes 2026-10-08); the report's «AÜ fehlt» caveat stands under the chart. The selected months
 * are shaded as plan months; months without a finished tour carry no point.
 */
@Component({
  selector: 'ac9-quote',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, RuleNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'ac9-quote' },
  template: `
    <app-card heading="Wie viele abgeschlossene Touren sind zurückgemeldet?" [q]="store.quote" sub="Rückmeldequote je Planmonat">
      <p class="ac9-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="280" [options]="options() ?? {}" [theme]="theme.echartsTheme()"
           aria-label="Rückmeldequote je Planmonat für AÜ und DL"></div>
      <ac9-rule [keys]="['quote']">
        <p>Arbeitnehmerüberlassung: «Rückmeldung fehlt» enthält auch Touren, die geplant, aber nie gefahren wurden (zu Jahresbeginn als Schichtblöcke vergebene Ruhetage). Die AÜ-Quote ist deshalb keine Nachfassliste.</p>
      </ac9-rule>
    </app-card>
  `,
})
export class Quote {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);

  private readonly plan = computed(() => [...new Set(this.store.quote.rows().map((r) => r.plan_monat))].sort());

  protected readonly answer = computed(() => {
    const t = this.store.kpiTotal();
    if (!t || t.quote == null) return '';
    const v = this.store.von();
    const when = v ? (v === this.store.bis() ? `im Planmonat ${monthLabel(v, true)}` : `in den Planmonaten ${this.store.rangeTextLong()}`) : 'über alle Planmonate';
    const ga = this.store.kpiGa().filter((r) => r.quote != null).map((r) => `${r.geschaeftsart} ${pct(r.quote, 1)}`).join(', ');
    return `${when[0].toUpperCase()}${when.slice(1)} sind ${pct(t.quote, 1)} der ${num(t.quote_abgeschlossen)} abgeschlossenen Touren zurückgemeldet${ga ? ` (${ga})` : ''}.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const months = this.plan();
    if (!months.length) return null;
    const rows = this.store.quote.rows();
    const t = this.theme.tokens();
    const c = ac9Colors(this.theme.mode());
    const at = (m: string, ga: string) => rows.find((r) => !r.ga_total && r.plan_monat === m && r.geschaeftsart === ga);
    const v = this.store.von();
    const b = this.store.bis();
    const series = (['AÜ', 'DL'] as const)
      .filter((ga) => rows.some((r) => r.geschaeftsart === ga))
      .map((ga, i) => ({
        id: `q-${ga}`, name: ga, type: 'line', symbol: 'circle', symbolSize: 7, connectNulls: false,
        lineStyle: { width: 2, color: ga === 'AÜ' ? c.aue : c.dl }, itemStyle: { color: ga === 'AÜ' ? c.aue : c.dl, borderColor: t.surface, borderWidth: 2 },
        data: months.map((m) => {
          const r = at(m, ga);
          return { value: r?.quote ?? null, name: m, symbol: this.store.running(m) ? 'emptyCircle' : 'circle' };
        }),
        endLabel: { show: true, color: t.ink2, formatter: (p: { seriesName: string }) => p.seriesName },
        // the selected months as plan months: one month = a hairline, a range = a band
        markArea: i === 0 && v && b && v !== b ? { silent: true, itemStyle: { color: t.grid, opacity: 0.7 }, data: [[{ xAxis: v }, { xAxis: b }]] } : undefined,
        markLine: i === 0 && v && v === b ? { silent: true, symbol: 'none', lineStyle: { color: t.ink2, type: 'solid', width: 1 },
          label: { formatter: 'gewählt', color: t.muted, position: 'end' }, data: [{ xAxis: v }] } : undefined,
      }));
    return {
      animationDuration: 400,
      aria: ariaDecal(),
      legend: legendTop(t),
      grid: { left: 8, right: 36, top: 32, bottom: 6, outerBounds: { left: 8, right: 36, top: 32, bottom: 6 } },
      xAxis: { type: 'category', data: months, boundaryGap: false, axisLabel: { color: t.muted, fontSize: 10.5, formatter: (m: string) => monthLabel(m) } },
      yAxis: { type: 'value', min: 0, max: 1, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (x: number) => pct(x) } },
      tooltip: {
        trigger: 'axis', confine: true,
        formatter: (ps: { name: string }[]) => {
          const m = ps[0]?.name;
          let html = ttHead(`Planmonat ${monthLabel(m, true)}` + (this.store.running(m) ? ' (läuft)' : ''));
          for (const ga of ['AÜ', 'DL']) {
            const r = at(m, ga);
            if (!r) continue;
            html += ttRow(ga === 'AÜ' ? c.aue : c.dl, `${ga} Quote`, r.quote == null ? 'keine Tour abgeschlossen' : pct(r.quote, 1)) +
              ttRow(null, `${ga} abgeschlossen / mit IST / fehlt`, `${num(r.abgeschlossen)} / ${num(r.mit_ist)} / ${num(r.fehlt)}`);
          }
          return html || BLANK;
        },
      },
      series,
    };
  });
}
