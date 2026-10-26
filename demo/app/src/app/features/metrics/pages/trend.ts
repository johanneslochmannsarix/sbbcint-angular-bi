import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { MetricsFilters } from '../data/filters';
import { BLANK, BLANK_TITLE, dateOnly, isoToDisplay, num, pct } from '../../../core/format';
import { metricsQuery } from '../data/query';
import {
  ParetoGold, ParetoKpis, ParetoScatter, ParetoSilver, ParetoTop20, TrendBatchSize, TrendBatchTable, TrendSizeByEnv, TrendSizeByTenant,
} from '../data/rows';
import { ThemeService } from '../../../core/theme';
import { ChartTokens } from '../../../core/tokens';
import { envColor, tenantColor, batchDate } from '../data/palette';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { barStyle, esc, grid, legendTop, ttHead, ttRow } from '../../../shared/chart-opts';
import { UiButton, UiTable } from '../../../shared/ui';

interface Range {
  from: string;
  to: string;
  batches: number;
}

const DAY = (iso: string | null) => (iso ? Date.parse(`${iso.slice(0, 10)}T00:00:00`) : NaN);
const TOP_N = 15;

@Component({
  selector: 'app-trend',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, UiButton, UiTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './trend.html',
})
export class TrendPage {
  private readonly f = inject(MetricsFilters);
  protected readonly theme = inject(ThemeService);
  protected readonly fmt = { num, pct, dateOnly, isoToDisplay, BLANK, BLANK_TITLE };

  // Size trends keep their series dimension unfiltered: by env = one tenant, every env; by tenant =
  // one env, every tenant. Batch size / table and the Pareto use the single tenant + env.
  protected readonly sizeByEnv = metricsQuery<TrendSizeByEnv>(() => ({ name: 'trend_size_by_env', params: this.f.params({ tenant: true, dates: true }) }));
  protected readonly sizeByTenant = metricsQuery<TrendSizeByTenant>(() => ({ name: 'trend_size_by_tenant', params: this.f.params({ env: true, dates: true }) }));
  protected readonly batchSize = metricsQuery<TrendBatchSize>(() => ({ name: 'trend_batch_size', params: this.f.params() }));
  protected readonly batchTable = metricsQuery<TrendBatchTable>(() => ({ name: 'trend_batch_table', params: this.f.params() }));

  /** The brushed batch range, or null = the whole window. Set only on brush END, debounced. */
  protected readonly range = signal<Range | null>(null);
  private readonly brush$ = new Subject<Range | null>();
  private chart: ECharts | null = null;

  private readonly paretoParams = () => {
    const p = this.f.params();
    const r = this.range();
    if (r) {
      p['date_from'] = r.from;
      p['date_to'] = r.to;
    }
    return p;
  };
  protected readonly pKpis = metricsQuery<ParetoKpis>(() => ({ name: 'pareto_kpis', params: this.paretoParams() }));
  protected readonly pTop20 = metricsQuery<ParetoTop20>(() => ({ name: 'pareto_ingest_top20', params: this.paretoParams() }));
  protected readonly pScatter = metricsQuery<ParetoScatter>(() => ({ name: 'pareto_ingest_scatter', params: this.paretoParams() }));
  protected readonly pSilver = metricsQuery<ParetoSilver>(() => ({ name: 'pareto_silver', params: this.paretoParams() }));
  protected readonly pGold = metricsQuery<ParetoGold>(() => ({ name: 'pareto_gold', params: this.paretoParams() }));
  protected readonly paretoLoading = computed(() => [this.pKpis, this.pTop20, this.pScatter, this.pSilver, this.pGold].some((q) => q.loading()));

  protected readonly showAllSilver = signal(false);
  protected readonly showAllGold = signal(false);

  protected readonly scopeText = computed(() => `${this.f.tenant() === 'CARGOCONTROL' ? 'CargoControl' : this.f.tenant()} ${this.f.env()}`);
  protected readonly rangeText = computed(() => {
    const r = this.range();
    const d = this.f.dates();
    return r
      ? `${isoToDisplay(r.from)} to ${isoToDisplay(r.to)}, ${r.batches} brushed batches`
      : `whole window, ${isoToDisplay(d.from)} to ${isoToDisplay(d.to)}`;
  });

  constructor() {
    this.brush$
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => (a?.from ?? '') === (b?.from ?? '') && (a?.to ?? '') === (b?.to ?? '')),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((r) => this.range.set(r));
    // A new filter or window invalidates a brushed range (it was a range of the old batch list).
    effect(() => {
      this.f.tenant();
      this.f.env();
      this.f.dates();
      untracked(() => {
        this.range.set(null);
        this.brush$.next(null);
      });
    });
    // Re-arm the brush cursor after every full option replace (setOption notMerge drops it).
    effect(() => {
      if (this.batchOptions()) untracked(() => setTimeout(() => this.armBrush(), 0));
    });
  }

  // ------------------------------------------------------------------ size trends
  protected readonly sizeByEnvOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.sizeByEnv.rows();
    if (!rows.length) return null;
    const keys = [...new Set(rows.map((r) => r.env ?? ''))].sort();
    return this.lineOptions(t, keys, (k) => envColor(t, k), (k) => rows.filter((r) => (r.env ?? '') === k).map((r) => [DAY(r.batch_date), r.size_per_batch_gib]));
  });
  protected readonly sizeByTenantOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.sizeByTenant.rows();
    if (!rows.length) return null;
    const keys = [...new Set(rows.map((r) => r.tenant ?? ''))].sort();
    return this.lineOptions(t, keys, (k) => tenantColor(t, k), (k) => rows.filter((r) => (r.tenant ?? '') === k).map((r) => [DAY(r.batch_date), r.size_per_batch_gib]));
  });

  private lineOptions(t: ChartTokens, keys: string[], color: (k: string) => string, data: (k: string) => (number | null)[][]): EChartsCoreOption {
    return {
      legend: legendTop(t),
      grid: grid(),
      tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? BLANK : `${num(v, 3)} GiB`) },
      xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', name: 'GiB per batch', nameTextStyle: { align: 'left' } },
      series: keys.map((k) => ({
        name: k === 'CARGOCONTROL' ? 'CargoControl' : k,
        type: 'line',
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { width: 2, color: color(k) },
        itemStyle: { color: color(k), borderColor: t.surface, borderWidth: 2 },
        data: data(k),
      })),
    };
  }

  // ------------------------------------------------------------------ batch size: brush source
  protected readonly batchOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.batchSize.rows();
    if (!rows.length) return null;
    return {
      animation: false,
      grid: grid({ top: 36, bottom: 56 }),
      toolbox: { right: 8, top: 0, itemSize: 14, feature: { brush: { type: ['lineX', 'clear'], title: { lineX: 'Brush a range', clear: 'Clear brush' } } } },
      brush: {
        xAxisIndex: 0,
        brushType: 'lineX',
        brushMode: 'single',
        throttleType: 'debounce',
        throttleDelay: 200,
        brushStyle: { color: 'rgba(42,120,214,0.10)', borderColor: t.series[0], borderWidth: 1 },
        outOfBrush: { colorAlpha: 0.25 },
      },
      dataZoom: [{ type: 'slider', xAxisIndex: 0, bottom: 8, height: 22, brushSelect: false, labelFormatter: (i: number) => this.batchLabel(rows[i]?.batch_id) }],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps: { dataIndex: number }[]) => {
          const r = rows[ps[0]?.dataIndex];
          return r ? ttHead(r.batch_id) + ttRow(t.series[0], 'Delivered size', r.delivered_size_gib == null ? BLANK : `${num(r.delivered_size_gib, 3)} GiB`) : '';
        },
      },
      xAxis: { type: 'category', data: rows.map((r) => r.batch_id), axisLabel: { formatter: (v: string) => this.batchLabel(v), hideOverlap: true } },
      yAxis: { type: 'value', name: 'GiB delivered', nameTextStyle: { align: 'left' } },
      series: [{ type: 'bar', name: 'Delivered size', barMaxWidth: 16, data: rows.map((r) => r.delivered_size_gib), itemStyle: barStyle(t.series[0], false) }],
    };
  });

  private batchLabel(id: string | undefined): string {
    const d = id ? batchDate(id) : null;
    return d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.` : (id ?? '');
  }

  protected onChartInit(c: ECharts): void {
    this.chart = c;
    // ngx-echarts emits chartInit before its first setOption: the brush component exists one tick later
    setTimeout(() => this.armBrush(), 0);
  }
  private armBrush(): void {
    this.chart?.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
  }

  /** brushEnd fires once when the drag ends (not on every move). coordRange = category indices. */
  protected onBrushEnd(e: { areas?: { coordRange?: number[] }[] }): void {
    const rows = this.batchSize.rows();
    const cr = e.areas?.[0]?.coordRange;
    if (!cr || cr.length < 2 || !rows.length) {
      this.brush$.next(null);
      return;
    }
    const i0 = Math.max(0, Math.min(rows.length - 1, Math.round(Math.min(cr[0], cr[1]))));
    const i1 = Math.max(0, Math.min(rows.length - 1, Math.round(Math.max(cr[0], cr[1]))));
    const dates = rows.slice(i0, i1 + 1).map((r) => batchDate(r.batch_id)).filter((d): d is string => !!d).sort();
    if (!dates.length) return;
    this.brush$.next({ from: dates[0], to: dates[dates.length - 1], batches: i1 - i0 + 1 });
  }
  protected clearBrush(): void {
    this.chart?.dispatchAction({ type: 'brush', areas: [] });
    this.brush$.next(null);
  }

  protected inRange(batchId: string): boolean {
    const r = this.range();
    const d = batchDate(batchId);
    return !!r && !!d && d >= r.from && d <= r.to;
  }

  // ------------------------------------------------------------------ Pareto panel
  /** Two aligned small multiples instead of the report's dual-axis combo: same keys, one scale each. */
  protected readonly top20Options = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.pTop20.rows();
    if (!rows.length) return null;
    const keys = rows.map((r) => r.key ?? BLANK);
    const y = (i: number, show: boolean) => ({ type: 'category', gridIndex: i, inverse: true, data: keys, axisLabel: { show, width: 150, overflow: 'truncate' }, axisLine: { show: false } });
    const title = (text: string, left: number | string) => ({ text, left, top: 0, textStyle: { fontSize: 12, fontWeight: 600, color: t.ink2 } });
    return {
      title: [title('Seconds per file', 4), title('MiB per file', '70%')],
      grid: [
        { left: 4, right: '33%', top: 40, bottom: 4, outerBounds: { left: 4, right: '33%', top: 40, bottom: 4 } },
        { left: '70%', right: 16, top: 40, bottom: 4 },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps: { dataIndex: number }[]) => {
          const r = rows[ps[0]?.dataIndex];
          return r ? ttHead(r.key ?? BLANK) + ttRow(t.series[0], 'Ingest s per file', num(r.ingest_s_per_file_top20, 2)) + ttRow(t.series[2], 'Ingest MiB per file', num(r.ingest_mib_per_file_top20, 2)) : '';
        },
      },
      xAxis: [
        { type: 'value', gridIndex: 0, position: 'top', axisLabel: { hideOverlap: true } },
        { type: 'value', gridIndex: 1, position: 'top', axisLabel: { hideOverlap: true }, splitNumber: 2 },
      ],
      yAxis: [y(0, true), y(1, false)],
      series: [
        { type: 'bar', name: 'Ingest s per file', xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 14, data: rows.map((r) => r.ingest_s_per_file_top20), itemStyle: barStyle(t.series[0], true) },
        { type: 'bar', name: 'Ingest MiB per file', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 14, data: rows.map((r) => r.ingest_mib_per_file_top20), itemStyle: barStyle(t.series[2], true) },
      ],
    };
  });
  protected readonly top20Height = computed(() => Math.max(160, this.pTop20.rows().length * 20 + 44));

  protected readonly scatterOptions = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const rows = this.pScatter.rows().filter((r) => r.ingest_mib_per_file != null && r.ingest_s_per_file != null);
    if (!rows.length) return null;
    return {
      grid: grid({ top: 28, bottom: 30 }),
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const r = rows[p.dataIndex];
          return ttHead(r.key ?? BLANK) + ttRow(null, 'MiB per file', num(r.ingest_mib_per_file, 2)) + ttRow(null, 's per file', num(r.ingest_s_per_file, 2));
        },
      },
      xAxis: { type: 'value', name: 'Ingest MiB per file', nameLocation: 'middle', nameGap: 24, splitLine: { show: true } },
      yAxis: { type: 'value', name: 'Ingest s per file', nameTextStyle: { align: 'left' } },
      series: [{
        type: 'scatter', name: 'Files by key', symbolSize: 9,
        itemStyle: { color: t.series[0], opacity: 0.8, borderColor: t.surface, borderWidth: 1.5 },
        data: rows.map((r) => [r.ingest_mib_per_file, r.ingest_s_per_file]),
      }],
    };
  });

  protected readonly silverOptions = computed(() => this.rankBar(this.pSilver.rows().map((r) => [r.key, r.silver_s_per_run] as const), this.showAllSilver(), 's per run'));
  protected readonly goldOptions = computed(() => this.rankBar(this.pGold.rows().map((r) => [r.key, r.gold_s_per_run] as const), this.showAllGold(), 's per run'));
  protected readonly silverHeight = computed(() => this.rankHeight(this.pSilver.rows().length, this.showAllSilver()));
  protected readonly goldHeight = computed(() => this.rankHeight(this.pGold.rows().length, this.showAllGold()));

  private rankHeight(n: number, all: boolean): number {
    return Math.max(120, (all ? n : Math.min(n, TOP_N)) * 20 + 40);
  }
  private rankBar(all: readonly (readonly [string | null, number | null])[], showAll: boolean, unit: string): EChartsCoreOption | null {
    const t = this.theme.tokens();
    const rows = (showAll ? all : all.slice(0, TOP_N)).filter((r) => r[1] != null);
    if (!rows.length) return null;
    return {
      grid: grid({ top: 24 }),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${num(v, 1)} s` },
      xAxis: { type: 'value', name: unit, nameLocation: 'start', position: 'top', nameTextStyle: { align: 'left', verticalAlign: 'bottom' } },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r[0] ?? BLANK), axisLabel: { width: 170, overflow: 'truncate' }, axisLine: { show: false } },
      series: [{ type: 'bar', name: unit, barMaxWidth: 14, data: rows.map((r) => r[1]), itemStyle: barStyle(t.series[0], true) }],
    };
  }
  protected readonly topN = TOP_N;
  protected readonly esc = esc;
}
