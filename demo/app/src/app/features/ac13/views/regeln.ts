import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { monthShort, num } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac13Colors } from '../data/palette';
import { Ac13Store } from '../data/store';

const monthMs = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).getTime();

/**
 * View 5 - the rule panel: how many sold tours (per Dienstleister) and trainings does each month hold, by which
 * rule? Small multiples on one shared month axis and one shared y-scale per rule (no dual axis): one panel per
 * Dienstleister (rule v1-dl_dienstleister_schichttyp) and one for Schulungen (rule v1-ausbildungselement). The
 * shown month is solid, the others light; a bar picks its month.
 */
@Component({
  selector: 'ac13-regeln',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wie viele verkaufte Touren und Schulungen hat jeder Monat, und nach welcher Regel?" [q]="[store.regeln, store.monate]"
              emptyNote="Für diese Auswahl gibt es weder verkaufte Touren noch Schulungen.">
      <p class="ac13-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"
           aria-label="Kleine Vielfache je Dienstleister und Schulungen je Monat"></div>
      <dl class="ac13-rules">
        <div><dt>Verkaufte Touren · {{ s()?.regel_verkauf }}</dt><dd>{{ s()?.hinweis_verkauf }}</dd></div>
        <div><dt>Schulungen · {{ s()?.regel_schulung }}</dt><dd>{{ s()?.hinweis_schulung }}</dd></div>
      </dl>
    </app-card>
  `,
})
export class RegelnView {
  protected readonly store = inject(Ac13Store);
  protected readonly theme = inject(ThemeService);
  protected readonly s = computed(() => this.store.stand.rows()[0] ?? null);

  private readonly layout = computed(() => {
    const months = this.store.monate.rows().map((r) => r.monat);
    const rows = this.store.regeln.rows().filter((r) => r.dienstleister);
    const tot = new Map<string, number>();
    for (const r of rows) tot.set(r.dienstleister!, (tot.get(r.dienstleister!) ?? 0) + r.verkauft);
    const dl = [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
    const panels = [...dl.map((d) => ({ name: d, kind: 'dl' as const })), { name: 'Schulungen', kind: 'schulung' as const }];
    return { months, rows, dl, panels };
  });
  protected readonly height = computed(() => Math.ceil(this.layout().panels.length / 3) * 118 + 20);

  protected readonly answer = computed(() => {
    const r = this.store.monthRow();
    const { rows, dl } = this.layout();
    if (!r) return '';
    const m = this.store.month();
    const top = dl.map((d) => ({ d, v: rows.find((x) => x.monat === m && x.dienstleister === d)?.verkauft ?? 0 })).sort((a, b) => b.v - a.v)[0];
    return `${num(r.verkauft)} verkaufte Touren${top?.v ? `, die meisten an ${top.d} (${num(top.v)})` : ''}; ${num(r.schulungen)} Touren mit einem Ausbildungselement.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const { months, rows, panels } = this.layout();
    if (!months.length) return null;
    const t = this.theme.tokens();
    const c = ac13Colors(this.theme.mode());
    const sel = this.store.month();
    const cols = 3;
    const w = 100 / cols;
    const maxDl = Math.max(1, ...rows.map((r) => r.verkauft));
    const schul = this.store.monate.rows().map((r) => r.schulungen);
    const grids = panels.map((_, i) => ({
      left: `${(i % cols) * w + 1.5}%`, width: `${w - 4}%`, top: Math.floor(i / cols) * 118 + 22, height: 70,
    }));
    return {
      aria: ariaDecal(),
      animation: false,
      tooltip: { trigger: 'item', confine: true },
      title: panels.map((p, i) => ({
        text: p.kind === 'dl' ? `DL ${p.name}` : p.name, left: grids[i].left, top: (grids[i].top as number) - 20,
        textStyle: { fontSize: 12, fontWeight: 600, color: t.ink2 },
      })),
      grid: grids,
      xAxis: panels.map((_, i) => ({
        gridIndex: i, type: 'category', data: months, axisTick: { show: false },
        axisLabel: { fontSize: 9.5, color: t.muted, interval: 0, formatter: (v: string) => monthShort(monthMs(v)).replace(/\s.*$/, '') },
      })),
      yAxis: panels.map((p, i) => ({
        gridIndex: i, type: 'value', min: 0, max: p.kind === 'dl' ? maxDl : Math.max(1, ...schul), splitNumber: 2,
        axisLabel: { fontSize: 9.5, color: t.muted, show: i % cols === 0 }, splitLine: { lineStyle: { color: t.grid } },
      })),
      series: panels.map((p, i) => ({
        type: 'bar', xAxisIndex: i, yAxisIndex: i, barMaxWidth: 14, cursor: 'pointer', name: p.name,
        data: months.map((m, j) => {
          const v = p.kind === 'dl' ? rows.find((r) => r.monat === m && r.dienstleister === p.name)?.verkauft ?? 0 : schul[j] ?? 0;
          return { value: v, name: m, itemStyle: { color: p.kind === 'dl' ? c.verkauft : c.schulung, opacity: m === sel ? 1 : 0.35, borderRadius: [2, 2, 0, 0] } };
        }),
        tooltip: {
          formatter: (x: { name: string; value: number }) => {
            const r = p.kind === 'dl' ? rows.find((y) => y.monat === x.name && y.dienstleister === p.name) : null;
            return ttHead(`${p.kind === 'dl' ? 'DL ' + p.name : p.name} · ${monthShort(monthMs(x.name))}`)
              + ttRow(p.kind === 'dl' ? c.verkauft : c.schulung, p.kind === 'dl' ? 'verkaufte Touren' : 'Schulungen', num(x.value))
              + (r ? ttRow(null, 'davon in CargoControl besetzt', num(r.besetzt)) : '');
          },
        },
      })),
    };
  });

  protected click(e: { name?: string }): void {
    if (e?.name && /^\d{4}-\d{2}$/.test(e.name)) this.store.pickMonth(e.name);
  }
}
