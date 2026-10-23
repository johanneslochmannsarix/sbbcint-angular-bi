import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, legendTop, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac7Store } from '../data/store';
import { STATUS_LABEL, StatusCode } from '../data/types';
import { STATUS_GLYPH, ac7Colors } from '../data/palette';

const NONE = 'ohne Angabe';

/**
 * View 6 - Arbeitszeit mix: persons per contractual monthly hours value (the contract valid at run time, else the
 * newest version), stacked by status. VZ / TZ / GfB is not derivable: the threshold is the customer's rule (offen),
 * so the app shows the hours as the model delivers them.
 */
@Component({
  selector: 'ac7-arbeitszeit',
  imports: [NgxEchartsDirective, ChartCard, ChartResize],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Mit welcher Arbeitszeit?" sub="Personen je vertraglicher Monatsarbeitszeit, nach Status" [q]="store.arbeitszeit">
      <div echarts class="chart h-280" [options]="options()!" [theme]="theme.echartsTheme()"></div>
      <p class="chart-note"><span class="ac7-offen">offen</span> Vollzeit / Teilzeit / geringfügig: die Schwelle legt RT&amp;S fest (Marcel Ludwig).
        Bis dahin zeigt die Liste Stunden je Monat, wie das PDF.</p>
    </app-card>
  `,
})
export class ArbeitszeitView {
  protected readonly store = inject(Ac7Store);
  protected readonly theme = inject(ThemeService);

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.arbeitszeit.rows().filter((r) => (r.personen ?? 0) > 0);
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac7Colors(t);
    const cats = [...new Set(rows.map((r) => (r.stunden == null ? NONE : `${num(r.stunden, Number.isInteger(r.stunden) ? 0 : 1)} h`)))];
    const order = (s: string) => (s === NONE ? Infinity : Number(s.replace(/[^\d,]/g, '').replace(',', '.')));
    cats.sort((a, b) => order(a) - order(b));
    const catOf = (h: number | null) => (h == null ? NONE : `${num(h, Number.isInteger(h) ? 0 : 1)} h`);
    const series = (['AKTIV', 'INAKTIV'] as StatusCode[]).map((s) => ({
      type: 'bar', name: `${STATUS_GLYPH[s]} ${STATUS_LABEL[s]}`, stack: 'p', barMaxWidth: 26,
      itemStyle: { color: c.status[s], borderColor: t.surface, borderWidth: 1 },
      data: cats.map((cat) => rows.filter((r) => r.status_code === s && catOf(r.stunden) === cat).reduce((a, r) => a + (r.personen ?? 0), 0) || null),
    }));
    return {
      animation: false,
      aria: ariaDecal(),
      legend: { ...legendTop(t) },
      grid: { left: 4, right: 8, top: 34, bottom: 4, outerBounds: { left: 4, right: 8, top: 34, bottom: 4 } },
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: (ps: { axisValue: string; seriesName: string; value: number | null; color: string }[]) =>
          ttHead(ps[0].axisValue === NONE ? 'ohne Monatsarbeitszeit im Vertrag' : `${ps[0].axisValue} pro Monat`)
          + ps.map((p) => ttRow(p.color, p.seriesName, num(p.value ?? 0))).join(''),
      },
      xAxis: { type: 'category', data: cats, axisTick: { show: false }, axisLabel: { color: t.ink2, interval: 0, fontSize: 11 } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: t.grid } } },
      series,
    };
  });
}
