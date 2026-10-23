import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { MetricsFilters } from '../data/filters';
import { BLANK, BLANK_TITLE, dateOnly, dateTimeLU, minutes, num, pct, timeLU, timeLocal, utcMs } from '../../../core/format';
import { metricsQuery } from '../data/query';
import {
  AnatomyChain, AnatomyExecTrend, AnatomyExecutorBusy, AnatomyGantt, AnatomyKpis, AnatomySparkDetail, AnatomySparkHistory, AnatomySparkStage,
  AnatomyStageQueue, AnatomyStageTable,
} from '../data/rows';

/** A Spark stage rollup is identified by name + status within one activity. */
const stageKey = (r: { name: string | null; status: string | null }) => `${r.name ?? ''}\u0000${r.status ?? ''}`;

interface StageSpan extends AnatomySparkDetail {
  s: number;
  e: number;
  key: string;
}
import { ThemeService } from '../../../core/theme';
import { ChartTokens, FONT_NUM } from '../../../core/tokens';
import { STAGE_ORDER, stageColor, stageRank, shortId } from '../data/palette';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { barStyle, grid, legendTop, ttHead, ttRow } from '../../../shared/chart-opts';

interface GanttRow extends AnatomyGantt {
  s: number;
  e: number;
  label: string;
}

/** Minimal typing for the custom-series renderItem arguments we use. */
interface RenderParams { dataIndex: number; coordSys: { x: number; y: number; width: number; height: number } }
interface RenderApi { value(dim: number): number; coord(v: number[]): number[]; size(v: number[]): number[] }

const DAY = (iso: string | null) => (iso ? Date.parse(`${iso.slice(0, 10)}T00:00:00`) : NaN);

@Component({
  selector: 'app-anatomy',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './anatomy.html',
})
export class AnatomyPage {
  /** ?chain=<run_id>, set by the Step stability outlier link. */
  readonly chain = input<string | undefined>();

  private readonly f = inject(MetricsFilters);
  protected readonly theme = inject(ThemeService);
  protected readonly fmt = { num, pct, minutes, dateOnly, dateTimeLU, timeLU, shortId, BLANK, BLANK_TITLE };

  private readonly base = () => this.f.params({ env: true, tenant: true, dates: true });
  protected readonly kpis = metricsQuery<AnatomyKpis>(() => ({ name: 'anatomy_kpis', params: this.base() }));
  protected readonly chains = metricsQuery<AnatomyChain>(() => ({ name: 'anatomy_chains', params: this.base() }));
  protected readonly stageQueue = metricsQuery<AnatomyStageQueue>(() => ({ name: 'anatomy_stage_queue', params: this.base() }));
  protected readonly executorBusy = metricsQuery<AnatomyExecutorBusy>(() => ({ name: 'anatomy_executor_busy', params: this.base() }));
  protected readonly execTrend = metricsQuery<AnatomyExecTrend>(() => ({ name: 'anatomy_exec_trend', params: this.base() }));
  protected readonly stageTable = metricsQuery<AnatomyStageTable>(() => ({ name: 'anatomy_stage_table', params: this.base() }));

  /** The user's pick; resets to the linked chain whenever a new ?chain= arrives. */
  protected readonly picked = linkedSignal<string | undefined, string | null>({ source: this.chain, computation: (c) => c ?? null });
  protected readonly chainId = computed(() => this.picked() ?? this.chains.rows()[0]?.run_id ?? null);
  protected readonly linkedNotInList = computed(() => {
    const c = this.chain();
    return !!c && this.picked() === c && !!this.chains.result() && !this.chains.rows().some((r) => r.run_id === c);
  });

  protected readonly gantt = metricsQuery<AnatomyGantt>(() => {
    const id = this.chainId();
    return id ? { name: 'anatomy_gantt', params: { chain_id: id } } : null;
  });
  /** Spark stages load on the first bar click of a chain, not with the chain (saves a call per chain). */
  protected readonly selectedActivity = linkedSignal<string | null, string | null>({ source: this.chainId, computation: () => null });
  protected readonly spark = metricsQuery<AnatomySparkStage>(() => {
    const id = this.chainId();
    return id && this.selectedActivity() ? { name: 'anatomy_spark_stages', params: { chain_id: id } } : null;
  });
  /** Detail columns and the time span per stage rollup, loaded with the Spark stages. */
  protected readonly sparkDetail = metricsQuery<AnatomySparkDetail>(() => {
    const id = this.chainId();
    return id && this.selectedActivity() ? { name: 'anatomy_spark_stage_detail', params: { chain_id: id } } : null;
  });
  /** The clicked Spark stage (name + status); resets when the activity changes. */
  protected readonly selectedStage = linkedSignal<string | null, string | null>({ source: this.selectedActivity, computation: () => null });
  /** The chain's stage names across the window's runs: loaded on the first stage click only. Stage names
   *  never travel as a parameter; the backend takes the chain's stage set server side. */
  protected readonly sparkHistory = metricsQuery<AnatomySparkHistory>(() => {
    const id = this.chainId();
    return id && this.selectedStage() ? { name: 'anatomy_spark_stage_history', params: { chain_id: id, ...this.base() } } : null;
  });

  protected readonly showAllEnvs = computed(() => this.f.tenant() === null);

  // ------------------------------------------------------------------ chains list
  protected readonly chainItems = computed(() =>
    this.chains.rows().map((r) => {
      const s = utcMs(r.chain_start);
      const e = utcMs(r.chain_end);
      return { ...r, s, wallMin: s != null && e != null ? (e - s) / 60000 : null };
    }),
  );

  // ------------------------------------------------------------------ Gantt
  protected readonly ganttRows = computed<GanttRow[]>(() =>
    this.gantt
      .rows()
      .map((r) => {
        const s = utcMs(r.activity_start);
        const e = utcMs(r.activity_end) ?? s;
        const retry = r.retry_attempt && r.retry_attempt > 0 ? ` (retry ${r.retry_attempt})` : '';
        return { ...r, s: s ?? NaN, e: e ?? NaN, label: `${r.activity_name ?? BLANK}${retry}` };
      })
      .filter((r) => !Number.isNaN(r.s))
      .sort((a, b) => a.s - b.s),
  );
  protected readonly ganttMeta = computed(() => {
    const rows = this.ganttRows();
    if (!rows.length) return null;
    const s = Math.min(...rows.map((r) => r.s));
    const e = Math.max(...rows.map((r) => r.e));
    const stages = [...new Set(rows.map((r) => r.stage ?? ''))].sort((a, b) => stageRank(a) - stageRank(b));
    return { s, e, wallMin: (e - s) / 60000, failed: rows.filter((r) => (r.status ?? '').toLowerCase() === 'failed').length, stages };
  });
  protected readonly ganttHeight = computed(() => Math.max(140, this.ganttRows().length * 34 + 48));

  protected readonly ganttOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.ganttRows();
    const meta = this.ganttMeta();
    if (!rows.length || !meta) return null;
    const sel = this.selectedActivity();
    const pad = Math.max((meta.e - meta.s) * 0.02, 30_000);
    return {
      animation: false,
      grid: grid({ left: 4, right: 64, top: 28, bottom: 4 }),
      tooltip: { trigger: 'item', formatter: (p: { dataIndex: number }) => this.ganttTip(rows[p.dataIndex], t) },
      xAxis: {
        type: 'time',
        position: 'top',
        min: meta.s - pad,
        max: meta.e + pad,
        splitLine: { show: true, lineStyle: { color: t.grid } },
        axisLabel: { formatter: (v: number) => timeLocal(v), hideOverlap: true },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map((r) => r.label),
        axisLine: { show: false },
        axisLabel: { color: t.ink2, width: 230, overflow: 'truncate' },
      },
      series: [
        {
          type: 'custom',
          name: 'Activities',
          encode: { x: [1, 2], y: 0 },
          data: rows.map((r, i) => [i, r.s, r.e]),
          renderItem: (params: RenderParams, api: RenderApi) => this.renderBar(params, api, rows, t, sel),
        },
      ],
    };
  });

  private renderBar(params: RenderParams, api: RenderApi, rows: GanttRow[], t: ChartTokens, sel: string | null): object {
    const r = rows[params.dataIndex];
    const cat = api.value(0);
    const p0 = api.coord([api.value(1), cat]);
    const p1 = api.coord([api.value(2), cat]);
    const h = Math.min(18, api.size([0, 1])[1] * 0.62);
    const top = p0[1] - h / 2;
    const cs = params.coordSys;
    const clip = (a: number, b: number): [number, number] | null => {
      const x0 = Math.max(a, cs.x);
      const x1 = Math.min(b, cs.x + cs.width);
      return x1 - x0 > 0.5 ? [x0, x1] : null;
    };
    const xEnd = Math.max(p1[0], p0[0] + 3);
    // queue drawn at its true time scale from the activity start, clamped to the bar
    const qMs = r.session_queued_min != null ? r.session_queued_min * 60_000 : 0;
    const qEnd = qMs > 0 ? Math.min(api.coord([api.value(1) + qMs, cat])[0], xEnd) : p0[0];
    const hasQueue = qEnd - p0[0] >= 1.5;
    const dim = sel !== null && r.activity_name !== sel;
    const opacity = dim ? 0.45 : 1;
    const children: object[] = [];
    if (hasQueue) {
      const c = clip(p0[0], qEnd - 1);
      if (c) children.push({ type: 'rect', shape: { x: c[0], y: top, width: c[1] - c[0], height: h, r: [3, 0, 0, 3] }, style: { fill: t.neutral, opacity } });
    }
    const c = clip(hasQueue ? qEnd + 1 : p0[0], xEnd);
    if (c) {
      children.push({
        type: 'rect',
        shape: { x: c[0], y: top, width: c[1] - c[0], height: h, r: hasQueue ? [0, 3, 3, 0] : 3 },
        style: { fill: stageColor(t, r.stage), opacity, stroke: r.activity_name === sel ? t.ink : undefined, lineWidth: r.activity_name === sel ? 1.5 : 0 },
      });
    }
    if ((r.status ?? '').toLowerCase() === 'failed' && xEnd + 6 < cs.x + cs.width + 60) {
      children.push(
        { type: 'rect', shape: { x: xEnd + 6, y: p0[1] - 4, width: 8, height: 8, r: 1 }, style: { fill: t.critical } },
        { type: 'text', style: { x: xEnd + 18, y: p0[1], text: 'failed', fill: t.ink, verticalAlign: 'middle', font: `12px ${FONT_NUM}` } },
      );
    }
    return { type: 'group', children };
  }

  private ganttTip(r: GanttRow, t: ChartTokens): string {
    const wall = (r.e - r.s) / 60000;
    const livy = r.session_queued_min == null && r.session_running_min == null;
    return [
      ttHead(r.label),
      ttRow(stageColor(t, r.stage), 'Stage', r.stage ?? BLANK),
      ttRow(null, 'Status', r.status ?? BLANK),
      ttRow(null, 'Start', timeLU(r.s)),
      ttRow(null, 'End', timeLU(r.e)),
      ttRow(null, 'Activity wall time', minutes(wall)),
      ttRow(null, 'Exec min (pipeline)', minutes(r.exec_min)),
      ttRow(t.neutral, 'Session queued (Livy)', livy ? 'no Livy reading' : minutes(r.session_queued_min)),
      ttRow(stageColor(t, r.stage), 'Session running (Livy)', livy ? 'no Livy reading' : minutes(r.session_running_min)),
      '<div style="margin-top:4px;opacity:.7">Click for the Spark stages</div>',
    ].join('');
  }

  protected onGanttClick(e: { seriesType?: string; dataIndex?: number }): void {
    if (e.seriesType !== 'custom' || e.dataIndex == null) return;
    const r = this.ganttRows()[e.dataIndex];
    if (r?.activity_name) this.selectedActivity.set(this.selectedActivity() === r.activity_name ? null : r.activity_name);
  }

  // ------------------------------------------------------------------ Spark drill
  protected readonly sparkRows = computed(() => {
    const a = this.selectedActivity();
    return this.spark.rows().filter((r) => r.activity_name === a);
  });
  protected readonly sparkOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.sparkBars();
    if (!rows.length) return null;
    const sel = this.selectedStage();
    const label = (r: AnatomySparkStage) => `${r.name ?? BLANK} [${r.status ?? BLANK}]`;
    return {
      grid: grid({ top: 8 }),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => minutes(v) },
      xAxis: { type: 'value', name: 'Stage run min (executor time, summed over tasks)', nameLocation: 'middle', nameGap: 26 },
      yAxis: { type: 'category', inverse: true, data: rows.map(label), axisLabel: { width: 260, overflow: 'truncate' } },
      series: [{
        type: 'bar', name: 'Stage run min', barMaxWidth: 18, cursor: 'pointer',
        data: rows.map((r) => {
          const on = sel === stageKey(r);
          return {
            value: r.stage_run_min,
            itemStyle: { ...barStyle(t.series[0], true), opacity: sel && !on ? 0.45 : 1, borderColor: on ? t.ink : undefined, borderWidth: on ? 1.5 : 0 },
          };
        }),
      }],
    };
  });
  private readonly sparkBars = computed(() => this.sparkRows().filter((r) => r.stage_run_min != null).slice(0, 12));
  protected readonly sparkHeight = computed(() => Math.max(120, Math.min(12, this.sparkRows().length) * 26 + 50));

  protected onSparkClick(e: { dataIndex?: number }): void {
    const r = e.dataIndex == null ? undefined : this.sparkBars()[e.dataIndex];
    if (r) this.pickStage(stageKey(r));
  }
  protected pickStage(key: string): void {
    this.selectedStage.set(this.selectedStage() === key ? null : key);
  }
  protected keyOf(r: { name: string | null; status: string | null }): string {
    return stageKey(r);
  }

  // ------------------------------------------------------------------ Spark stage Gantt (1 row per rollup)
  protected readonly stageSpans = computed<StageSpan[]>(() => {
    const a = this.selectedActivity();
    return this.sparkDetail
      .rows()
      .filter((r) => r.activity_name === a)
      .map((r) => {
        const s = utcMs(r.first_submission);
        const e = utcMs(r.last_completion) ?? s;
        return { ...r, s: s ?? NaN, e: e ?? NaN, key: stageKey(r) };
      })
      .filter((r) => !Number.isNaN(r.s))
      .sort((x, y) => x.s - y.s);
  });
  protected readonly stageSpanMissing = computed(() => {
    const a = this.selectedActivity();
    return this.sparkDetail.rows().filter((r) => r.activity_name === a).length - this.stageSpans().length;
  });
  protected readonly stageGanttHeight = computed(() => Math.max(120, this.stageSpans().length * 26 + 48));
  protected readonly stageGanttOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.stageSpans();
    if (!rows.length) return null;
    const sel = this.selectedStage();
    const s = Math.min(...rows.map((r) => r.s));
    const e = Math.max(...rows.map((r) => r.e));
    const pad = Math.max((e - s) * 0.02, 5_000);
    const done = (r: StageSpan) => (r.status ?? '').toUpperCase() === 'COMPLETE';
    return {
      animation: false,
      grid: grid({ left: 4, right: 24, top: 28, bottom: 4 }),
      tooltip: { trigger: 'item', formatter: (p: { dataIndex: number }) => this.stageSpanTip(rows[p.dataIndex], t) },
      xAxis: {
        type: 'time', position: 'top', min: s - pad, max: e + pad,
        splitLine: { show: true, lineStyle: { color: t.grid } },
        axisLabel: { formatter: (v: number) => timeLocal(v), hideOverlap: true },
      },
      yAxis: {
        type: 'category', inverse: true, data: rows.map((r) => `${r.name ?? BLANK} [${r.status ?? BLANK}]`),
        axisLine: { show: false }, axisLabel: { color: t.ink2, width: 260, overflow: 'truncate' },
      },
      series: [{
        type: 'custom',
        name: 'Spark stages',
        cursor: 'pointer',
        encode: { x: [1, 2], y: 0 },
        data: rows.map((r, i) => [i, r.s, r.e]),
        renderItem: (params: RenderParams, api: RenderApi) => {
          const r = rows[params.dataIndex];
          const cat = api.value(0);
          const p0 = api.coord([api.value(1), cat]);
          const p1 = api.coord([api.value(2), cat]);
          const h = Math.min(14, api.size([0, 1])[1] * 0.6);
          const on = sel === r.key;
          return {
            type: 'rect',
            shape: { x: p0[0], y: p0[1] - h / 2, width: Math.max(p1[0] - p0[0], 2), height: h, r: 2 },
            style: { fill: done(r) ? t.series[0] : t.neutral, opacity: sel && !on ? 0.45 : 1, stroke: on ? t.ink : undefined, lineWidth: on ? 1.5 : 0 },
          };
        },
      }],
    };
  });

  private stageSpanTip(r: StageSpan, t: ChartTokens): string {
    return [
      ttHead(r.name ?? BLANK),
      ttRow(null, 'Status', r.status ?? BLANK),
      ttRow(null, 'First submitted', timeLU(r.s)),
      ttRow(null, 'Last completed', timeLU(r.e)),
      ttRow(null, 'Span', minutes((r.e - r.s) / 60000)),
      ttRow(t.series[0], 'Executor run min', minutes(r.stage_run_min)),
      ttRow(null, 'Spark stages / tasks', `${num(r.spark_stages, 0)} / ${num(r.num_tasks, 0)}`),
      '<div style="margin-top:4px;opacity:.7">Click for the stage detail</div>',
    ].join('');
  }

  protected onStageGanttClick(e: { seriesType?: string; dataIndex?: number }): void {
    if (e.seriesType !== 'custom' || e.dataIndex == null) return;
    const r = this.stageSpans()[e.dataIndex];
    if (r) this.pickStage(r.key);
  }

  // ------------------------------------------------------------------ stage detail + history
  protected readonly stage = computed(() => {
    const key = this.selectedStage();
    const a = this.selectedActivity();
    if (!key) return null;
    const r = this.sparkDetail.rows().find((x) => x.activity_name === a && stageKey(x) === key);
    if (!r) return null;
    const s = utcMs(r.first_submission);
    const e = utcMs(r.last_completion);
    const run = r.stage_run_min ?? 0;
    const cpu = r.cpu_min ?? 0;
    const gc = r.gc_min ?? 0;
    // executor run time = CPU + GC + the rest (I/O, shuffle fetch, scheduling waits); shares of the run time
    const other = Math.max(run - cpu - gc, 0);
    return {
      ...r,
      spanMin: s != null && e != null ? (e - s) / 60000 : null,
      s, e,
      split: run > 0 ? { cpu: cpu / run, gc: gc / run, other: other / run } : null,
    };
  });
  protected readonly historyPoints = computed(() => {
    const key = this.selectedStage();
    const a = this.selectedActivity();
    if (!key) return [];
    return this.sparkHistory
      .rows()
      .filter((r) => r.activity_name === a && `${r.name ?? ''}` === key.split('\u0000')[0])
      .map((r) => ({ ...r, x: utcMs(r.run_start) }))
      .filter((r): r is AnatomySparkHistory & { x: number } => r.x != null && r.stage_run_min != null)
      .sort((p, q) => p.x - q.x);
  });
  protected readonly historyStats = computed(() => {
    const v = this.historyPoints().map((r) => r.stage_run_min as number).sort((a, b) => a - b);
    if (!v.length) return null;
    const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
    const cur = this.historyPoints().find((r) => r.run_id === this.chainId())?.stage_run_min ?? null;
    const rank = cur == null ? null : v.filter((x) => x <= cur).length / v.length;
    return { n: v.length, median: q(0.5), p90: q(0.9), cur, rank };
  });
  protected readonly historyOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const pts = this.historyPoints();
    const st = this.historyStats();
    if (!pts.length || !st) return null;
    const cur = this.chainId();
    return {
      grid: grid({ top: 24 }),
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const r = pts[p.dataIndex];
          return [ttHead(dateTimeLU(r.x)), ttRow(t.series[0], 'Executor run min', minutes(r.stage_run_min)), ttRow(null, 'Spark stages', num(r.spark_stages, 0)),
            r.run_id === cur ? '<div style="margin-top:4px;opacity:.7">This chain</div>' : '<div style="margin-top:4px;opacity:.7">Click to open this chain</div>'].join('');
        },
      },
      xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', name: 'Executor run min', nameTextStyle: { align: 'left' } },
      series: [{
        type: 'line',
        name: 'Executor run min',
        cursor: 'pointer',
        symbol: 'circle',
        lineStyle: { width: 1.5, color: t.series[0], opacity: 0.6 },
        data: pts.map((r) => ({
          value: [r.x, r.stage_run_min],
          symbolSize: r.run_id === cur ? 12 : 6,
          itemStyle: { color: r.run_id === cur ? t.ink : t.series[0], borderColor: t.surface, borderWidth: r.run_id === cur ? 2 : 1 },
        })),
        markLine: {
          silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: t.ink2 },
          label: { color: t.ink2, formatter: (p: { name: string }) => p.name, position: 'insideEndTop' },
          data: [{ name: `median ${minutes(st.median)}`, yAxis: st.median }, { name: `p90 ${minutes(st.p90)}`, yAxis: st.p90 }],
        },
      }],
    };
  });
  protected onHistoryClick(e: { dataIndex?: number }): void {
    const r = e.dataIndex == null ? undefined : this.historyPoints()[e.dataIndex];
    if (!r || r.run_id === this.chainId()) return;
    const activity = this.selectedActivity();
    const key = this.selectedStage();
    this.picked.set(r.run_id);
    // the linked selections reset with the chain; read them once so they settle, then restore the drill
    this.selectedActivity();
    this.selectedActivity.set(activity);
    this.selectedStage();
    this.selectedStage.set(key);
  }

  // ------------------------------------------------------------------ stage queue / executor / trend
  protected readonly stageQueueOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = [...this.stageQueue.rows()].sort((a, b) => stageRank(a.stage) - stageRank(b.stage));
    if (!rows.length) return null;
    const seg = { borderColor: t.surface, borderWidth: 1 };
    return {
      legend: legendTop(t),
      grid: grid(),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number | null) => minutes(v) },
      xAxis: { type: 'category', data: rows.map((r) => r.stage) },
      yAxis: { type: 'value', name: 'min', nameTextStyle: { align: 'right' } },
      series: [
        { name: 'Session queued (Livy)', type: 'bar', stack: 'q', barMaxWidth: 24, data: rows.map((r) => r.session_queued_min), itemStyle: { color: t.neutral, ...seg } },
        { name: 'Session running (Livy)', type: 'bar', stack: 'q', barMaxWidth: 24, data: rows.map((r) => r.session_running_min), itemStyle: { ...barStyle(t.series[0], false), ...seg } },
      ],
    };
  });

  protected readonly executorOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.executorBusy.rows();
    if (!rows.length) return null;
    return {
      grid: grid({ top: 8 }),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number | null) => minutes(v) },
      xAxis: { type: 'value', name: 'Executor busy min', nameLocation: 'middle', nameGap: 26 },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.activity_name), axisLabel: { width: 200, overflow: 'truncate' } },
      series: [{ type: 'bar', name: 'Executor busy min', barMaxWidth: 20, data: rows.map((r) => r.executor_busy_min), itemStyle: barStyle(t.series[0], true) }],
    };
  });

  protected readonly execTrendOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.execTrend.rows();
    if (!rows.length) return null;
    const stages = [...new Set(rows.map((r) => r.stage ?? ''))].sort((a, b) => stageRank(a) - stageRank(b));
    return {
      legend: legendTop(t),
      grid: grid(),
      tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => minutes(v) },
      xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', name: 'Exec min per day', nameTextStyle: { align: 'left' } },
      series: stages.map((st) => ({
        name: st,
        type: 'line',
        connectNulls: false,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { width: 2, color: stageColor(t, st) },
        itemStyle: { color: stageColor(t, st), borderColor: t.surface, borderWidth: 2 },
        data: rows.filter((r) => (r.stage ?? '') === st).map((r) => [DAY(r.start_date), r.exec_min]),
      })),
    };
  });

  protected readonly stageOrder = STAGE_ORDER;
  protected stageDot(stage: string | null): string {
    return stageColor(this.theme.tokens(), stage);
  }
  protected pick(id: string): void {
    this.picked.set(id);
  }
}
