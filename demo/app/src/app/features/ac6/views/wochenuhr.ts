import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num, pct } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { MergeOptions } from '../../../shared/merge-options';
import { ac6Colors } from '../data/palette';
import { Ac6Store } from '../data/store';
import { DAY_SHORT, hourLabel } from '../data/week';

type Shape = 'uhr' | 'band';
type Measure = 'stunden' | 'touren';
const ARTS = [
  { art: 'h_ja', label: 'Fahren (laut SaxMS)', key: 'fahren' },
  { art: 'h_nein', label: 'übrige Tätigkeiten', key: 'jup' },
  { art: 'h_leer', label: 'ohne Tätigkeit / Kennzeichen', key: 'neutral' },
] as const;

/**
 * View 3 - the pattern week, the page's one loud element. One clock face for the whole week: 168 hourly bars
 * around the dial (Monday 00 at twelve o'clock, clockwise, a day per seventh), morphing (universalTransition,
 * merged with replaceMerge like AC-8's Schichtuhr) into a straight ribbon Mo 00 → So 24. Measure: planned element
 * hours in the hour, stacked by the source flag «Fahren (ja/nein)» (not a classification - ADR-046), or the tours
 * running in the hour (the plan's «Bedarf» picture). Tours past Sunday 24:00 wrap onto Monday (the DAX does it).
 * Clicking a bar filters every view to that weekday.
 */
@Component({
  selector: 'ac6-wochenuhr',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, MergeOptions],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wie sieht eine normale Woche dieser Planung aus?" [q]="store.woche" emptyNote="Unter diesem Filter plant die Version keine Elemente.">
      <div card-tools class="ac6-tools">
        <div class="seg seg-sm" role="group" aria-label="Messgrösse">
          <button type="button" [attr.aria-pressed]="measure() === 'stunden'" (click)="measure.set('stunden')">Stunden</button>
          <button type="button" [attr.aria-pressed]="measure() === 'touren'" (click)="measure.set('touren')">Touren im Einsatz</button>
        </div>
        <div class="seg seg-sm" role="group" aria-label="Darstellung">
          <button type="button" [attr.aria-pressed]="shape() === 'uhr'" (click)="shape.set('uhr')">Wochenuhr</button>
          <button type="button" [attr.aria-pressed]="shape() === 'band'" (click)="shape.set('band')">Band</button>
        </div>
      </div>
      <p class="ac6-answer">{{ answer() }}</p>
      <div echarts class="chart ac6-uhr" [style.height.px]="450" [options]="blank" [mergeOptions]="options()"
           [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"
           [attr.aria-label]="'Musterwoche Stunde für Stunde, ' + (measure() === 'stunden' ? 'geplante Elementstunden' : 'Touren im Einsatz')"></div>
      @if (measure() === 'stunden') {
        <div class="ac6-legend" aria-label="Legende">
          @for (l of legend(); track l.label) { <span><i [style.background]="l.color"></i>{{ l.label }}</span> }
        </div>
      }
      <p class="ac6-note">Die Musterwoche hat kein Kalenderdatum: Zeiten sind Versätze ab Montag 00:00. Touren über Sonntag 24:00 laufen auf den Montag weiter. «Fahren» ist das Hauptfahrt-Kennzeichen der Tätigkeit aus SaxMS, keine Klassifikation: Kernleistung, Reserve und Dispo ordnet das Controlling im eigenen Workbook zu.</p>
    </app-card>
  `,
})
export class WochenuhrView {
  protected readonly store = inject(Ac6Store);
  protected readonly theme = inject(ThemeService);
  protected readonly shape = signal<Shape>('uhr');
  protected readonly measure = signal<Measure>('stunden');
  protected readonly blank: EChartsCoreOption = {};

  private readonly grid = computed(() => {
    const g: Record<string, number[]> = { h_ja: [], h_nein: [], h_leer: [], touren: [] };
    for (const k of Object.keys(g)) g[k] = new Array(168).fill(0);
    for (const r of this.store.woche.rows()) if (r.stunde >= 0 && r.stunde < 168 && g[r.art]) g[r.art][r.stunde] = r.wert ?? 0;
    return g;
  });

  protected readonly legend = computed(() => {
    const c = ac6Colors(this.theme.mode());
    return ARTS.map((a) => ({ label: a.label, color: c[a.key] }));
  });

  protected readonly answer = computed(() => {
    const g = this.grid();
    if (!this.store.woche.rows().length) return '';
    const t = g['touren'];
    let peak = 0;
    let low = 0;
    t.forEach((v, k) => { if (v > t[peak]) peak = k; if (v < t[low]) low = k; });
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    const all = sum(g['h_ja']) + sum(g['h_nein']) + sum(g['h_leer']);
    const dayH = Array.from({ length: 7 }, (_, d) => ['h_ja', 'h_nein', 'h_leer'].reduce((s, a) => s + sum(g[a].slice(d * 24, d * 24 + 24)), 0));
    const busiest = dayH.indexOf(Math.max(...dayH));
    return `Am meisten läuft ${hourLabel(peak)} mit ${num(t[peak])} Touren gleichzeitig, am wenigsten ${hourLabel(low)} (${num(t[low])}). ` +
      `Stärkster Tag ist der ${DAY_SHORT[busiest]} mit ${hours(dayH[busiest], 0)}; ${pct(all ? sum(g['h_ja']) / all : null, 1)} der ${hours(all, 0)} sind Fahren.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    if (!this.store.woche.rows().length) return null;
    const t = this.theme.tokens();
    const c = ac6Colors(this.theme.mode());
    const g = this.grid();
    const band = this.shape() === 'band';
    const sel = this.store.tag();
    const stunden = this.measure() === 'stunden';
    const parts = stunden ? ARTS.map((a) => ({ id: a.art, name: a.label, color: c[a.key], data: g[a.art] }))
      : [{ id: 'touren', name: 'Touren im Einsatz', color: c.jup, data: g['touren'] }];
    const hoursIdx = Array.from({ length: 168 }, (_, k) => k);
    const op = (k: number) => (sel == null || Math.floor(k / 24) === sel ? 1 : 0.28);
    const series = parts.map((p) => ({
      id: `${p.id}-${band ? 'band' : 'uhr'}`, name: p.name, type: 'bar', stack: 'w',
      ...(band ? { coordinateSystem: 'cartesian2d' } : { coordinateSystem: 'polar' }),
      universalTransition: { enabled: true, seriesKey: p.id },
      barCategoryGap: band ? '12%' : '4%', cursor: 'pointer',
      animationDurationUpdate: 900, animationEasingUpdate: 'cubicInOut',
      itemStyle: { color: p.color },
      // one height for both shapes: a resize during the morph left the polar sectors stuck (2026-10-21)
      data: p.data.map((v, k) => ({ id: `${p.id}-${k}`, value: band ? [k, v] : v, itemStyle: { opacity: op(k) } })),
    }));
    const tip = (k: number) => {
      let html = ttHead(hourLabel(k));
      if (stunden) {
        for (const a of ARTS) html += ttRow(c[a.key], a.label, hours(g[a.art][k], 1));
      }
      return html + ttRow(stunden ? null : c.jup, 'Touren im Einsatz', num(g['touren'][k]));
    };
    const max = Math.max(1, ...hoursIdx.map((k) => (stunden ? g['h_ja'][k] + g['h_nein'][k] + g['h_leer'][k] : g['touren'][k])));
    // day labels around the dial at each day's noon; day separators as split lines every 24 h
    return {
      aria: ariaDecal(),
      animationDurationUpdate: 900,
      tooltip: { trigger: 'item', confine: true, formatter: (p: { dataIndex: number }) => tip(p.dataIndex) },
      polar: { center: ['50%', '52%'], radius: band ? [0, 1] : ['22%', '88%'] },
      angleAxis: {
        type: 'category', data: hoursIdx, startAngle: 90, clockwise: true, boundaryGap: true, show: !band,
        axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
        splitLine: { show: !band, interval: (k: number) => k % 24 === 0, lineStyle: { color: t.axis, width: 1 } },
        axisLabel: {
          interval: (k: number) => k % 24 === 12, color: t.ink, fontFamily: FONT_NUM, fontSize: 13, fontWeight: 600,
          formatter: (v: string) => DAY_SHORT[Math.floor(Number(v) / 24)],
        },
      },
      radiusAxis: {
        type: 'value', max, show: !band, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { show: false }, splitLine: { show: !band, lineStyle: { color: t.grid } }, splitNumber: 3,
      },
      grid: band ? { left: 44, right: 8, top: 14, bottom: 26 } : { left: 0, top: 0, width: 1, height: 1 },
      xAxis: {
        type: 'category', data: hoursIdx, show: band,
        axisLabel: { interval: (k: number) => k % 24 === 0, formatter: (v: string) => DAY_SHORT[Number(v) / 24] ?? '', color: t.ink2, fontFamily: FONT_NUM, align: 'left' },
        splitLine: { show: band, interval: (k: number) => k % 24 === 0, lineStyle: { color: t.axis } }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', show: band, name: stunden ? 'h je Stunde' : 'Touren', nameTextStyle: { color: t.muted, align: 'left' },
        splitLine: { show: band, lineStyle: { color: t.grid } }, axisLabel: { color: t.muted },
      },
      graphic: {
        elements: [{
          id: 'center', type: 'text', left: 'center', top: 'middle', invisible: band,
          style: { text: stunden ? 'Stunden\nje Wochenstunde' : 'Touren\nim Einsatz', align: 'center', fill: t.muted, font: `12px ${FONT_NUM}`, lineHeight: 16 },
        }],
      },
      series,
    };
  });

  protected click(e: { dataIndex?: number }): void {
    if (e?.dataIndex == null) return;
    const d = Math.floor(e.dataIndex / 24);
    this.store.pickTag(this.store.tag() === d ? null : d);
  }
}
