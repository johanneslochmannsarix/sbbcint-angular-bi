import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { monthShort, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ChartGroup } from '../../../shared/connect';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac13Colors } from '../data/palette';
import { Ac13Store } from '../data/store';

const monthMs = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).getTime();

/**
 * View 7 - the fill strip: for how many tours per month does CargoControl carry angerechnete Zeit at all? The
 * 12H / 14H thresholds rest on it, so the August / September gap (accepted by the customer) is shown, not hidden:
 * filled share per month as a 100 % bar (filled / not filled), on the KPI band's month group.
 */
@Component({
  selector: 'ac13-fill',
  imports: [NgxEchartsDirective, ChartResize, ChartGroup, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Für wie viele Touren liegt angerechnete Zeit vor?" [q]="store.monate">
      <p class="ac13-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="190" [options]="options()!" [theme]="theme.echartsTheme()" chartGroup="ac13-monate"
           (chartClick)="click($any($event))" aria-label="Anteil Touren mit angerechneter Zeit je Monat"></div>
      <p class="ac13-note">Die Schwellwerte 12 h / 14 h zählen nur Touren mit angerechneter Zeit; in Monaten mit Lücke sind sie deshalb zu tief.</p>
    </app-card>
  `,
})
export class FillView {
  protected readonly store = inject(Ac13Store);
  protected readonly theme = inject(ThemeService);

  protected readonly answer = computed(() => {
    const rows = this.store.monate.rows().filter((r) => r.touren > 0);
    if (!rows.length) return '';
    const s = (r: (typeof rows)[0]) => pct(r.touren ? r.angerechnet_touren / r.touren : null, 0);
    return rows.map((r) => `${monthShort(monthMs(r.monat))} ${s(r)}`).join(', ') + '.';
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.monate.rows().filter((r) => r.touren > 0);
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac13Colors(this.theme.mode());
    const sel = this.store.month();
    const share = rows.map((r) => (r.touren ? r.angerechnet_touren / r.touren : 0));
    return {
      aria: ariaDecal(),
      animation: false,
      grid: { left: 8, right: 8, top: 8, bottom: 8, outerBounds: { left: 8, right: 8, top: 8, bottom: 8 } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { dataIndex: number }[]) => {
          const r = rows[ps[0].dataIndex];
          return ttHead(monthShort(monthMs(r.monat))) + ttRow(c.anger, 'mit angerechneter Zeit', `${num(r.angerechnet_touren)} (${pct(share[ps[0].dataIndex], 1)})`)
            + ttRow(t.neutral, 'ohne', num(r.touren - r.angerechnet_touren));
        },
      },
      xAxis: { type: 'category', data: rows.map((r) => r.monat), axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: string) => monthShort(monthMs(v)) } },
      yAxis: { type: 'value', min: 0, max: 1, splitNumber: 2, axisLabel: { formatter: (v: number) => pct(v, 0), fontSize: 10 } },
      series: [
        { type: 'bar', stack: 'f', barMaxWidth: 34, cursor: 'pointer', name: 'mit angerechneter Zeit',
          data: share.map((v, i) => ({ value: v, name: rows[i].monat, itemStyle: { color: c.anger, opacity: rows[i].monat === sel ? 1 : 0.55 } })),
          label: { show: true, position: 'insideBottom', color: t.surface, fontSize: 10.5, formatter: (p: { value: number }) => (p.value >= 0.12 ? pct(p.value, 0) : '') } },
        { type: 'bar', stack: 'f', cursor: 'pointer', name: 'ohne',
          data: share.map((v, i) => ({ value: 1 - v, name: rows[i].monat, itemStyle: { color: t.grid, borderRadius: [3, 3, 0, 0] } })),
          label: { show: true, position: 'insideTop', color: t.ink2, fontSize: 10.5, formatter: (p: { dataIndex: number }) => (share[p.dataIndex] < 0.12 ? pct(share[p.dataIndex], 1) : '') } },
      ],
    };
  });

  protected click(e: { name?: string }): void {
    if (e?.name) this.store.pickMonth(e.name);
  }
}
