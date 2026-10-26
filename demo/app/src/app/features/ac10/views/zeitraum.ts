import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ChartResize } from '../../../shared/chart-resize';
import { ThemeService } from '../../../core/theme';
import { addDays, dateShort, dayMs, isoDay, num, today } from '../../../core/format';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac10Store, isoWeek } from '../data/store';
import { ac10Colors } from '../data/palette';
import { UiOption, UiSeg } from '../../../shared/ui';

type Preset = 'standard' | 'woche' | 'naechste' | 'vier' | 'alles';

const WD = new Intl.DateTimeFormat('de-CH', { weekday: 'short' });
const LONG = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * View 6 - Zeitraum: open shifts per day over the whole Gold window as bars, the chosen window as a draggable
 * lineX brush (drag across a month end in one move - the report's date picker needs Shift + paging for that).
 * From / to and the ISO weeks are LABELS of the brush, not a second filter (Johannes rejected an AND-stacked
 * KW slicer). Presets: −3…+7 (the report's Variante A default, rolling with today), this / next week, 4 weeks,
 * the whole window.
 */
@Component({
  selector: 'ac10-zeitraum',
  imports: [NgxEchartsDirective, ChartResize, UiSeg],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './zeitraum.css',
  host: { class: 'ac10-zeit', role: 'group', 'aria-label': 'Zeitraum' },
  template: `
    <div class="ac10-zeit-head">
      <div class="ac10-zeit-range" aria-live="polite">
        <span class="ac10-zeit-dates">{{ rangeText() }}</span>
        <span class="ac10-zeit-meta">{{ metaText() }}</span>
      </div>
      <ui-seg size="sm" ariaLabel="Zeitraum-Vorlagen" [options]="presetOptions" [value]="presetValue()" (valueChange)="store.preset($event)" />
    </div>
    <div echarts class="ac10-zeit-chart" [options]="options()!" [theme]="theme.echartsTheme()" (chartInit)="chart.set($event)"
         role="img" [attr.aria-label]="'Ungeplante Schichten je Tag im aufbereiteten Fenster; gewählt ' + rangeText()"></div>
    <p class="ac10-zeit-hint">Bereich ziehen, um den Zeitraum zu wählen; auch über ein Monatsende. Balken = ungeplante Schichten je Tag.</p>
  `,
})
export class ZeitraumView {
  protected readonly store = inject(Ac10Store);
  protected readonly theme = inject(ThemeService);
  protected readonly chart = signal<ECharts | null>(null);
  protected readonly presetOptions: UiOption<Preset>[] = [
    { value: 'standard', label: '−3 … +7 Tage', title: 'Standard wie im Bericht: heute −3 bis +7 Tage, läuft jeden Tag mit' },
    { value: 'woche', label: 'Diese Woche' },
    { value: 'naechste', label: 'Nächste Woche' },
    { value: 'vier', label: '4 Wochen' },
    { value: 'alles', label: 'Ganzes Fenster' },
  ];
  protected readonly presetValue = computed<Preset | null>(() => (this.store.isDefaultWindow() ? 'standard' : this.active()));

  protected readonly rangeText = computed(() => `${LONG.format(dayMs(this.store.from())!)} – ${LONG.format(dayMs(this.store.to())!)}`);
  protected readonly metaText = computed(() => {
    const a = dayMs(this.store.from())!;
    const b = dayMs(this.store.to())!;
    const days = Math.round((b - a) / 86_400_000) + 1;
    const k1 = isoWeek(a);
    const k2 = isoWeek(b);
    const y1 = new Date(a).getFullYear();
    const y2 = new Date(b).getFullYear();
    const kw = k1 === k2 && b - a < 7 * 86_400_000 ? `KW ${k1}` : y1 === y2 ? `KW ${k1}–${k2}` : `KW ${k1}/${y1} – ${k2}/${y2}`;
    return `${days} Tage · ${kw}`;
  });
  protected readonly active = computed(() => {
    const t = today();
    const m = addDays(t, -((new Date(t).getDay() + 6) % 7));
    const f = this.store.from();
    const to = this.store.to();
    if (f === isoDay(m) && to === isoDay(addDays(m, 6))) return 'woche';
    if (f === isoDay(addDays(m, 7)) && to === isoDay(addDays(m, 13))) return 'naechste';
    if (f === isoDay(t) && to === isoDay(addDays(t, 27))) return 'vier';
    const s = this.store.stand.rows()[0];
    if (s && f === s.fenster_von?.slice(0, 10) && to === s.fenster_bis?.slice(0, 10)) return 'alles';
    return null;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.timeline.rows();
    const s = this.store.stand.rows()[0];
    if (!rows.length || !s) return null;
    const t = this.theme.tokens();
    const c = ac10Colors(t);
    const now = today();
    const min = dayMs(s.fenster_von)! - 43_200_000;
    const max = dayMs(s.fenster_bis)! + 43_200_000;
    return {
      animation: false,
      aria: ariaDecal(),
      grid: { left: 2, right: 2, top: 6, bottom: 22 },
      xAxis: {
        type: 'time', min, max,
        axisLabel: { formatter: (v: number) => `${dateShort(v)}`, hideOverlap: true, fontSize: 11 },
        splitNumber: 14,
      },
      yAxis: { type: 'value', show: false, min: 0 },
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: (ps: { value: [number, number, number, string] }[]) => {
          const v = ps[0].value;
          return ttHead(`${WD.format(v[0])} ${dateShort(v[0])} · ${v[3]}`) + ttRow(c.open, 'Ungeplante Schichten', num(v[1])) +
            ttRow(null, 'davon zwingend', num(v[2]));
        },
      },
      brush: {
        xAxisIndex: 0, brushType: 'lineX', brushMode: 'single', transformable: true, throttleType: 'debounce', throttleDelay: 0,
        brushStyle: { color: t.seq[0], opacity: 0.25, borderColor: t.ink2, borderWidth: 1 },
        outOfBrush: { opacity: 0.35 }, inBrush: { opacity: 1 },
      },
      toolbox: { show: false },
      series: [{
        type: 'bar', barCategoryGap: '18%', large: false,
        itemStyle: { color: c.open, borderRadius: [2, 2, 0, 0] },
        data: rows.map((r) => [dayMs(r.datum), r.ungeplant, r.ungeplant_zwingend, r.jahr_kw]),
        markLine: {
          silent: true, symbol: 'none', label: { formatter: 'heute', color: t.ink2, fontSize: 11, position: 'insideEndTop' },
          lineStyle: { color: c.today, type: 'solid', width: 1 }, data: [{ xAxis: now }],
        },
      }],
    };
  });

  constructor() {
    // the brush is state, not option: re-draw it after every setOption (theme switch, data, window) and listen once
    effect(() => {
      const ch = this.chart();
      const o = this.options();
      const a = dayMs(this.store.from())! - 43_200_000;
      const b = dayMs(this.store.to())! + 43_200_000;
      if (!ch || !o || ch.isDisposed()) return;
      queueMicrotask(() => {
        if (ch.isDisposed()) return;
        ch.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
        ch.dispatchAction({ type: 'brush', areas: [{ brushType: 'lineX', xAxisIndex: 0, coordRange: [a, b] }] });
      });
    });
    let bound: ECharts | null = null;
    effect(() => {
      const ch = this.chart();
      if (!ch || ch === bound) return;
      bound = ch;
      ch.on('brushEnd', (e: unknown) => {
        const area = (e as { areas?: { coordRange?: [number, number] }[] }).areas?.[0];
        if (!area?.coordRange) return;
        const s = this.store.stand.rows()[0];
        const lo = dayMs(s?.fenster_von ?? null) ?? -Infinity;
        const hi = dayMs(s?.fenster_bis ?? null) ?? Infinity;
        const from = Math.max(lo, Math.min(hi, roundDay(area.coordRange[0] + 43_200_000)));
        const to = Math.max(from, Math.min(hi, roundDay(area.coordRange[1] - 43_200_000)));
        if (isoDay(from) !== this.store.from() || isoDay(to) !== this.store.to()) this.store.setWindow(isoDay(from), isoDay(to));
      });
    });
    inject(DestroyRef).onDestroy(() => bound?.off('brushEnd'));
  }
}

function roundDay(ms: number): number {
  const d = new Date(ms);
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return ms - base >= 43_200_000 ? addDays(base, 1) : base;
}
