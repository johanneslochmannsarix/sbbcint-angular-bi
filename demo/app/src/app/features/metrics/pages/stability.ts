import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { MetricsFilters } from '../data/filters';
import { BLANK, BLANK_TITLE, dateOnly, dateTimeLU, num, pct, utcMs } from '../../../core/format';
import { metricsQuery } from '../data/query';
import { StabilityBox, StabilityControl, StabilityCv, StabilityRegime, StabilityTable } from '../data/rows';
import { ThemeService } from '../../../core/theme';
import { stageColor, stageRank, shortId } from '../data/palette';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { barStyle, grid, legendTop, ttHead, ttRow } from '../../../shared/chart-opts';
import { UiButton, UiSeg, UiSelect, UiSelectOption, UiTable } from '../../../shared/ui';

/** Stages whose run_id is a notebook job id, not a chain run (collector STANDALONE_STAGES). */
const STANDALONE = new Set(['maintenance', 'retention']);
type RegimeSel = 'current' | 'all' | string;

interface Point { step_s: number; run_id: string | null; run_start: number | null; regime_label: string | null; is_current: boolean | null }
interface Group { step: string; points: Point[] }
interface OutlierPick { stage: string; step: string; value: number; runs: Point[] }

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

@Component({
  selector: 'app-stability',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, RouterLink, UiButton, UiSeg, UiSelect, UiTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stability.html',
})
export class StabilityPage {
  private readonly f = inject(MetricsFilters);
  protected readonly theme = inject(ThemeService);
  protected readonly fmt = { num, pct, dateOnly, dateTimeLU, shortId, BLANK, BLANK_TITLE };

  protected readonly box = metricsQuery<StabilityBox>(() => ({ name: 'stability_box', params: this.f.params() }));
  protected readonly regimes = metricsQuery<StabilityRegime>(() => ({ name: 'stability_regimes', params: this.f.params() }));
  protected readonly control = metricsQuery<StabilityControl>(() => ({ name: 'stability_control', params: this.f.params() }));
  protected readonly cv = metricsQuery<StabilityCv>(() => ({ name: 'stability_cv_by_step', params: this.f.params() }));
  protected readonly table = metricsQuery<StabilityTable>(() => ({ name: 'stability_table', params: this.f.params() }));

  // ------------------------------------------------------------------ selection (client side: no extra calls)
  protected readonly stages = computed(() =>
    [...new Set(this.box.rows().map((r) => r.stage ?? ''))].filter((s) => s).sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b)),
  );
  protected readonly stage = linkedSignal<string[], string | null>({
    source: this.stages,
    computation: (list, prev) => (prev?.value && list.includes(prev.value) ? prev.value : (list[0] ?? null)),
  });
  protected readonly regime = linkedSignal<string | null, RegimeSel>({ source: this.stage, computation: () => 'current' });
  protected readonly stageRegimes = computed(() => this.regimes.rows().filter((r) => r.stage === this.stage()));
  protected readonly regimeOptions = computed<UiSelectOption[]>(() => [
    { value: 'current', label: 'Current regime' },
    { value: 'all', label: 'All regimes' },
    ...this.stageRegimes().map((r) => ({ value: String(r.regime_label), label: `${r.regime_label ?? ''} (from ${this.fmt.dateOnly(r.regime_from)}, n ${r.regime_n ?? ''})` })),
  ]);

  /** Steps of one stage span orders of magnitude; on a shared linear axis most boxes are hairlines. */
  protected readonly logScale = signal(true);
  /** Runs at 0 s cannot sit on a log axis; they are left out of the drawing (and counted). */
  protected readonly droppedForLog = computed(() =>
    this.logScale() ? this.box.rows().filter((r) => r.stage === this.stage() && r.step_s != null && r.step_s <= 0 && this.inRegime(r)).length : 0,
  );
  private inRegime(r: StabilityBox): boolean {
    const sel = this.regime();
    return sel === 'all' || (sel === 'current' ? r.is_current === true : r.regime_label === sel);
  }

  protected readonly groups = computed<Group[]>(() => {
    const st = this.stage();
    const sel = this.regime();
    const log = this.logScale();
    const by = new Map<string, Point[]>();
    for (const r of this.box.rows()) {
      if (r.stage !== st || r.step_s == null || r.step == null) continue;
      if (log && r.step_s <= 0) continue;
      if (sel === 'current' && r.is_current !== true) continue;
      if (sel !== 'current' && sel !== 'all' && r.regime_label !== sel) continue;
      const list = by.get(r.step) ?? [];
      list.push({ step_s: r.step_s, run_id: r.run_id, run_start: utcMs(r.run_start), regime_label: r.regime_label, is_current: r.is_current });
      by.set(r.step, list);
    }
    return [...by.entries()].map(([step, points]) => ({ step, points }));
  });

  protected readonly step = linkedSignal<Group[], string | null>({
    source: this.groups,
    computation: (gs, prev) => (prev?.value && gs.some((g) => g.step === prev.value) ? prev.value : (gs[0]?.step ?? null)),
  });
  protected readonly outlier = linkedSignal<Group[], OutlierPick | null>({ source: this.groups, computation: () => null });

  protected readonly regimeText = computed(() => {
    const r = this.regime();
    return r === 'current' ? 'current regime' : r === 'all' ? 'all regimes' : `regime ${r}`;
  });

  // ------------------------------------------------------------------ box plot
  protected readonly boxHeight = computed(() => Math.max(160, this.groups().length * 30 + 70));
  protected readonly boxOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const gs = this.groups();
    if (!gs.length) return null;
    const labels = gs.map((g) => g.step);
    const sel = this.step();
    const color = stageColor(t, this.stage());
    return {
      animation: false,
      legend: { ...legendTop(t), data: ['Step s per run', 'Outlier runs'] },
      grid: grid({ top: 36, bottom: 32 }),
      dataset: [
        { source: gs.map((g) => g.points.map((p) => p.step_s)) },
        // built-in transform (registered by BoxplotChart): Low/Q1/Q2/Q3/High per row, 1.5 IQR whiskers;
        // result 1 holds the outliers as [itemName, value]
        { fromDatasetIndex: 0, transform: { type: 'boxplot', config: { itemNameFormatter: (p: { value: number }) => labels[p.value] } } },
        { fromDatasetIndex: 1, fromTransformResult: 1 },
      ],
      tooltip: {
        trigger: 'item',
        formatter: (p: { seriesType: string; value: (string | number)[] }) => {
          const v = p.value;
          if (p.seriesType === 'boxplot') {
            const n = gs.find((g) => g.step === v[0])?.points.length ?? 0;
            return [
              ttHead(String(v[0])),
              ttRow(null, 'Runs', String(n)),
              ttRow(null, 'Whisker high', `${num(v[5] as number, 1)} s`),
              ttRow(null, 'Q3', `${num(v[4] as number, 1)} s`),
              ttRow(color, 'Median', `${num(v[3] as number, 1)} s`),
              ttRow(null, 'Q1', `${num(v[2] as number, 1)} s`),
              ttRow(null, 'Whisker low', `${num(v[1] as number, 1)} s`),
              '<div style="margin-top:4px;opacity:.7">Display statistics from the points; the model numbers are in the table</div>',
            ].join('');
          }
          return ttHead(String(v[0])) + ttRow(t.ink2, 'Outlier', `${num(v[1] as number, 1)} s`) + '<div style="margin-top:4px;opacity:.7">Click for the run</div>';
        },
      },
      xAxis: {
        type: this.logScale() ? 'log' : 'value',
        name: this.logScale() ? 'Seconds per run (Step s), log scale' : 'Seconds per run (Step s)',
        nameLocation: 'middle',
        nameGap: 24,
        splitLine: { show: true },
        axisLabel: { formatter: (v: number) => num(v, v < 0.1 ? 3 : v < 1 ? 2 : v < 10 ? 1 : 0) },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: labels,
        axisLine: { show: false },
        axisLabel: {
          width: 220,
          overflow: 'truncate',
          formatter: (v: string) => (v === sel ? `{sel|${v}}` : v),
          rich: { sel: { fontWeight: 700, color: t.ink } },
        },
      },
      series: [
        {
          name: 'Step s per run',
          type: 'boxplot',
          datasetIndex: 1,
          encode: { y: 'ItemName', x: ['Low', 'Q1', 'Q2', 'Q3', 'High'] },
          boxWidth: [8, 16],
          itemStyle: { color: rgba(color, 0.16), borderColor: color, borderWidth: 1.5 },
          emphasis: { itemStyle: { color: rgba(color, 0.3), borderColor: color, borderWidth: 2 } },
        },
        {
          name: 'Outlier runs',
          type: 'scatter',
          datasetIndex: 2,
          encode: { y: 0, x: 1 },
          symbolSize: 9,
          // neutral ink: the box wears the stage colour, so an outlier must never share it
          itemStyle: { color: t.ink2, borderColor: t.surface, borderWidth: 2 },
          emphasis: { scale: 1.4 },
        },
      ],
    };
  });

  protected onBoxClick(e: { seriesType?: string; value?: unknown; name?: string }): void {
    const v = e.value as (string | number)[] | undefined;
    if (!v) return;
    const step = String(v[0]);
    this.step.set(step);
    if (e.seriesType === 'scatter') {
      const value = Number(v[1]);
      const g = this.groups().find((x) => x.step === step);
      // the transform outputs the raw number, so exact equality finds the run(s) behind the dot
      const runs = (g?.points ?? []).filter((p) => p.step_s === value);
      this.outlier.set({ stage: this.stage() ?? '', step, value, runs });
    }
  }

  protected isStandalone(stage: string): boolean {
    return STANDALONE.has(stage);
  }

  // ------------------------------------------------------------------ control chart for the selected step
  protected readonly controlRows = computed(() =>
    this.control
      .rows()
      .filter((r) => r.stage === this.stage() && r.step === this.step())
      .map((r) => ({ ...r, ms: utcMs(r.activity_start) }))
      .filter((r) => r.ms != null),
  );
  protected readonly controlOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.controlRows();
    if (!rows.length) return null;
    const out = rows.filter((r) => r.step_s != null && ((r.ctl_upper_s != null && r.step_s > r.ctl_upper_s) || (r.ctl_lower_s != null && r.step_s < r.ctl_lower_s)));
    const line = (name: string, key: 'ctl_median_s' | 'ctl_upper_s' | 'ctl_lower_s', color: string, dashed: boolean) => ({
      name, type: 'line', showSymbol: false, step: 'end',
      lineStyle: { width: dashed ? 1.5 : 2, color, type: dashed ? 'dashed' : 'solid' },
      itemStyle: { color },
      data: rows.map((r) => [r.ms, r[key]]),
    });
    return {
      animation: false,
      legend: legendTop(t),
      grid: grid({ top: 40 }),
      tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? BLANK : `${num(v, 1)} s`) },
      xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', name: 's per run', nameTextStyle: { align: 'left' } },
      series: [
        {
          name: 'Step s', type: 'line', symbol: 'circle', symbolSize: 7,
          lineStyle: { width: 2, color: t.series[0] }, itemStyle: { color: t.series[0], borderColor: t.surface, borderWidth: 2 },
          data: rows.map((r) => [r.ms, r.step_s]),
        },
        line('Control median', 'ctl_median_s', t.ink2, false),
        line('Upper limit', 'ctl_upper_s', t.muted, true),
        line('Lower limit', 'ctl_lower_s', t.muted, true),
        {
          name: 'Outside the limits', type: 'scatter', symbol: 'diamond', symbolSize: 12, z: 5,
          itemStyle: { color: t.serious, borderColor: t.surface, borderWidth: 2 },
          data: out.map((r) => [r.ms, r.step_s]),
        },
      ],
    };
  });

  // ------------------------------------------------------------------ CV by step
  protected readonly cvOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.cv.rows().filter((r) => r.regime_cv != null);
    if (!rows.length) return null;
    return {
      grid: grid({ top: 24 }),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${num(v, 1)} %` },
      xAxis: { type: 'value', name: 'Regime CV, %', nameLocation: 'start', position: 'top', nameTextStyle: { align: 'left', verticalAlign: 'bottom' } },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.step), axisLabel: { width: 200, overflow: 'truncate' }, axisLine: { show: false } },
      series: [{ type: 'bar', name: 'Regime CV', barMaxWidth: 16, data: rows.map((r) => (r.regime_cv as number) * 100), itemStyle: barStyle(t.series[0], true) }],
    };
  });
  protected readonly cvHeight = computed(() => Math.max(140, this.cv.rows().length * 24 + 44));
  protected readonly maxRegimeN = computed(() => {
    const ns = this.table.rows().map((r) => r.regime_n).filter((n): n is number => n != null);
    return ns.length ? Math.max(...ns) : null;
  });
  protected readonly cvEmptyNote = computed(() => {
    const n = this.maxRegimeN();
    return `Regime CV is blank below 20 runs in a regime (the model's rule), so no step is rankable yet.${n != null ? ` The largest Regime n in the table below is ${n}.` : ''}`;
  });

  protected readonly selectedTableRow = signal<string | null>(null);
  protected pickRow(r: StabilityTable): void {
    if (r.stage) this.stage.set(r.stage);
    if (r.step) this.step.set(r.step);
  }
  protected stageDot(stage: string | null): string {
    return stageColor(this.theme.tokens(), stage);
  }
  protected setRegime(v: string): void {
    this.regime.set(v);
  }
}
