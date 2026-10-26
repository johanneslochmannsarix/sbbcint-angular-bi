import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { dateShort, dayMs, isoDay, localMs, num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { UiButton, UiOption, UiSeg } from '../../../shared/ui';
import { ac8Colors } from '../data/palette';
import { Ac8Store } from '../data/store';
import { VersionRow } from '../data/types';

const DAY = 86_400_000;
const BIN_X = DAY; // density: 1 creation day ...
const BIN_Y = 2; //            x 2 days of lead time

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
}

/**
 * View 5 - how many hours before the shift does a version appear? One point per version (versions query,
 * vorlauf_h computed by the model query): x = created_ts, y = lead time in days, Erstversion vs Änderung.
 * large + progressive rendering for PROD volume (13.6 k points on the whole plan). Density: a custom series
 * draws 1-day x 2-day bins under the points (binning = layout). p10 / p50 / p90 are quantiles of the
 * returned lead times. A brush selects created-days x lead-time and filters the pipeline and the river
 * (server side, both re-query with the brush).
 */
@Component({
  selector: 'ac8-leadtime',
  imports: [NgxEchartsDirective, ChartCard, UiSeg, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Vorlaufzeit der Versionen" [sub]="sub()" [q]="store.versions">
      <div card-tools class="ac8-tools">
        <ui-seg size="sm" ariaLabel="Darstellung" [options]="layerOptions" [value]="layer()" (valueChange)="layer.set($event)" />
        @if (store.brush()) { <ui-button (click)="clearBrush()">Auswahl aufheben</ui-button> }
      </div>
      <div echarts class="chart" style="height: 360px" [options]="options()!" [theme]="theme.echartsTheme()"
           (chartInit)="init($any($event))" (chartBrushEnd)="brushEnd($any($event))" (chartBrush)="brushCleared($any($event))" (chartClick)="click($any($event))"></div>
      <p class="chart-note">Rechteck aufziehen (Werkzeug oben rechts) wählt Erstellungstage und Vorlaufzeit: Pipeline und Änderungsfluss zeigen dann nur Schichten mit einer Version in der Auswahl. Unter null: Version nach Schichtbeginn erstellt. Punkt anklicken öffnet den Versionsverlauf.</p>
    </app-card>
  `,
})
export class LeadtimeView {
  protected readonly store = inject(Ac8Store);
  protected readonly theme = inject(ThemeService);
  protected readonly layer = signal<'beides' | 'punkte' | 'dichte'>('beides');
  protected readonly layerOptions: UiOption<'beides' | 'punkte' | 'dichte'>[] = [
    { value: 'beides', label: 'Punkte + Dichte' },
    { value: 'punkte', label: 'Punkte' },
    { value: 'dichte', label: 'Dichte' },
  ];
  private chart: { dispatchAction: (a: object) => void } | null = null;

  /** rows after focus / story filtering; index = position in the series data */
  private readonly rows = computed(() => {
    const focus = this.store.focusShifts();
    return this.store.versions.rows().filter((v) => v.vorlauf_h != null && v.created_ts && (!focus || focus.has(v.shift_sk)));
  });

  private readonly lead = computed(() => this.rows().map((v) => v.vorlauf_h!).sort((a, b) => a - b));
  protected readonly sub = computed(() => {
    const l = this.lead();
    if (!this.store.versions.result()) return '';
    const p50 = quantile(l, 0.5);
    const neg = l.filter((x) => x < 0).length;
    const f = this.store.focus();
    return `${num(l.length)} Versionen${f ? ` von Schichten «${f}»` : ''}, Median ${num((p50 ?? 0) / 24, 1)} Tage vor Beginn, ${num(neg)} erst nach Beginn erstellt`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const c = ac8Colors(t);
    const rows = this.rows();
    const week = this.store.storyWeek();
    const wk = week ? [dayMs(week.from)!, dayMs(week.to)! + DAY] : null;
    const erst: number[][] = [];
    const aend: number[][] = [];
    const rest: number[][] = [];
    const bins = new Map<string, number>();
    rows.forEach((v: VersionRow, i) => {
      const x = localMs(v.created_ts)!;
      const y = v.vorlauf_h! / 24;
      const start = localMs(v.snapshot_start);
      const p = [x, y, i];
      if (wk && !(start != null && start >= wk[0] && start < wk[1])) rest.push(p);
      else (v.version_nr === 1 ? erst : aend).push(p);
      const k = `${Math.floor(x / BIN_X)}|${Math.floor(y / BIN_Y)}`;
      bins.set(k, (bins.get(k) ?? 0) + 1);
    });
    const cells = [...bins].map(([k, n]) => {
      const [bx, by] = k.split('|').map(Number);
      return [bx * BIN_X, by * BIN_Y, n];
    });
    const maxBin = Math.max(1, ...cells.map((x) => x[2]));
    const ramp = t.seq;
    const binColor = (n: number) => ramp[Math.min(ramp.length - 1, Math.floor((Math.log(n) / Math.log(maxBin + 1)) * ramp.length))];
    const l = this.lead();
    const qs = [0.1, 0.5, 0.9].map((q) => quantile(l, q));
    const showPts = this.layer() !== 'dichte';
    const showDen = this.layer() !== 'punkte';
    const scatter = (name: string, data: number[][], color: string, opacity: number) => ({
      type: 'scatter', name, data: showPts ? data : [], symbolSize: 4, large: true, largeThreshold: 2000, progressive: 4000, progressiveThreshold: 6000,
      itemStyle: { color, opacity }, emphasis: { disabled: true },
    });
    return {
      aria: ariaDecal(),
      animation: false,
      legend: { top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: t.ink2 }, data: ['Erstversion', 'Änderung', ...(wk ? ['andere Wochen'] : [])] },
      grid: { left: 52, right: 56, top: 34, bottom: 52 },
      toolbox: { right: 8, top: -4, feature: { brush: { type: ['rect', 'clear'], title: { rect: 'Auswahl aufziehen', clear: 'Auswahl aufheben' } } } },
      brush: { toolbox: ['rect', 'clear'], xAxisIndex: 0, yAxisIndex: 0, throttleType: 'debounce', throttleDelay: 300, brushStyle: { color: 'rgba(42,120,214,0.10)', borderColor: t.ink2, borderWidth: 1 }, outOfBrush: { colorAlpha: 0.25 } },
      dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }, { type: 'inside', yAxisIndex: 0, filterMode: 'none' }, { type: 'slider', xAxisIndex: 0, height: 16, bottom: 6, filterMode: 'none' }],
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: { seriesType: string; value: number[] }) => p.seriesType === 'custom'
          ? ttHead(`erstellt ${dateShort(p.value[0])}`) + ttRow(null, `Vorlauf ${p.value[1]}–${p.value[1] + BIN_Y} Tage`, `${num(p.value[2])} Versionen`)
          : ttHead(`erstellt ${dateShort(p.value[0])}`) + ttRow(null, 'Vorlauf', `${num(p.value[1], 1)} Tage`),
      },
      xAxis: { type: 'time', axisLabel: { color: t.muted }, splitLine: { show: false } },
      yAxis: { type: 'value', name: 'Tage vor Schichtbeginn', nameLocation: 'middle', nameGap: 36, nameTextStyle: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } } },
      series: [
        {
          type: 'custom', name: 'Dichte', silent: false, z: 1, data: showDen ? cells : [],
          renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[] }) => {
            const a = api.coord([api.value(0), api.value(1) + BIN_Y]);
            const b = api.coord([api.value(0) + BIN_X, api.value(1)]);
            return { type: 'rect', shape: { x: a[0], y: a[1], width: Math.max(1, b[0] - a[0]), height: Math.max(1, b[1] - a[1]) }, style: { fill: binColor(api.value(2)), opacity: showPts ? 0.55 : 0.95 } };
          },
          encode: { x: 0, y: 1 },
        },
        ...(wk ? [scatter('andere Wochen', rest, t.neutral, 0.35)] : []),
        scatter('Erstversion', erst, c.erst, 0.55),
        { ...scatter('Änderung', aend, c.aenderung, 0.65),
          markLine: {
            silent: true, symbol: 'none', lineStyle: { color: t.ink2, type: 'dashed', width: 1 },
            label: { color: t.ink2, position: 'end', formatter: (p: { name: string }) => p.name },
            data: [
              { yAxis: 0, name: 'Beginn', lineStyle: { type: 'solid', color: t.ink } },
              ...qs.map((q, i) => (q == null ? null : { yAxis: q / 24, name: `p${[10, 50, 90][i]}` })).filter(Boolean),
            ],
          },
        },
      ],
    };
  });

  protected init(chart: { dispatchAction: (a: object) => void }): void {
    this.chart = chart;
  }

  protected brushEnd(e: { areas?: { coordRange?: number[][] }[] }): void {
    const r = e.areas?.[0]?.coordRange;
    if (!r) {
      this.store.brush.set(null);
      return;
    }
    const [[x0, x1], [y0, y1]] = r;
    this.store.brush.set({ from: isoDay(x0), to: isoDay(x1), leadMin: Math.floor(y0 * 24), leadMax: Math.ceil(y1 * 24) });
  }

  /** the toolbox «clear» fires a brush event without areas, not a brushEnd */
  protected brushCleared(e: { areas?: unknown[] }): void {
    if (e.areas && e.areas.length === 0 && this.store.brush()) this.store.brush.set(null);
  }

  protected clearBrush(): void {
    this.chart?.dispatchAction({ type: 'brush', areas: [] });
    this.store.brush.set(null);
  }

  protected click(e: { seriesType?: string; value?: number[] }): void {
    if (e.seriesType !== 'scatter' || !e.value) return;
    const v = this.rows()[e.value[2]];
    if (v) {
      this.store.shift.set(v.shift_sk);
      document.getElementById('ac8-versionen')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}
