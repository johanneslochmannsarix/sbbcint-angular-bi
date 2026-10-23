import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { dayMs, localMs, num } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { MergeOptions } from '../../../shared/merge-options';
import { averagePerOccurrence, plannedOccupancy, sollOccupancy, weekdayCounts } from '../data/coverage';
import { DECAL, ac8Colors } from '../data/palette';
import { Ac8Store } from '../data/store';

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DISP = 'CINT (CH) - Disponent Leitstelle';
const EPS = 0.05;

/**
 * View 2 - «Schichtuhr»: at which weekday hour does the staffed plan fall short of the SOLL pattern week?
 * Seven 24-hour dials (polar bars, 0 h at the top, clockwise): SOLL as an outline, staffed planned shifts
 * filled (average per occurrence of that weekday in the window), the shortfall stacked on top, hatched.
 * «Band» morphs the same bars (universalTransition, same series ids, same data index) into one linear week.
 * SOLL comes from ONE planning variant (the model has five, without validity dates).
 */
@Component({
  selector: 'ac8-schichtuhr',
  imports: [NgxEchartsDirective, MergeOptions, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Schichtuhr: SOLL gegen besetzte Schichten" [sub]="sub()" [q]="[store.soll, store.shifts, store.plannings]">
      <div card-tools class="ac8-tools">
        <select class="select" aria-label="SOLL-Planung" (change)="store.planningPick.set($any($event.target).value)">
          @for (p of plannings(); track p.shift_planning_sk) {
            <option [value]="p.shift_planning_sk" [selected]="p.shift_planning_sk === store.planning()">{{ p.planning_name }}</option>
          }
        </select>
        <div class="seg seg-sm" role="group" aria-label="Darstellung">
          <button type="button" [attr.aria-pressed]="shape() === 'uhr'" (click)="shape.set('uhr')">Uhr</button>
          <button type="button" [attr.aria-pressed]="shape() === 'band'" (click)="shape.set('band')">Band</button>
        </div>
      </div>
      <div echarts class="chart ac8-uhr" [style.height.px]="height()" [options]="blank" [mergeOptions]="options()" [theme]="theme.echartsTheme()"></div>
      <div class="legend-inline ac8-legend">
        <span><i class="key ac8-key-outline"></i>SOLL ({{ planningName() }})</span>
        <span><i class="key" [style.background]="colors().plan"></i>besetzt geplant, Ø je {{ store.storyWeek() ? 'Tag der Woche' : 'Wochentag im Fenster' }}</span>
        <span><i class="key ac8-key-hatch" [style.background]="colors().gap"></i>Unterdeckung</span>
      </div>
      <p class="chart-note">{{ planningNote() }} Eine Schicht zählt anteilig in jeder Stunde, die sie überdeckt. Unbesetzte Schichten zählen nicht als Abdeckung.</p>
    </app-card>
  `,
})
export class Schichtuhr {
  protected readonly store = inject(Ac8Store);
  protected readonly theme = inject(ThemeService);
  protected readonly shape = signal<'uhr' | 'band'>('uhr');
  private readonly width = signal(1200);
  protected readonly colors = computed(() => ac8Colors(this.theme.tokens()));

  /** ngx-echarts gets an empty option; shared/merge-options.ts applies options() with replaceMerge on series,
   *  so the old shape's series leave and the new ones morph in by seriesKey. */
  protected readonly blank: EChartsCoreOption = {};

  constructor() {
    const el = inject(ElementRef<HTMLElement>);
    afterNextRender(() => {
      const ro = new ResizeObserver((e) => this.width.set(Math.round(e[0].contentRect.width)));
      ro.observe(el.nativeElement);
    });
  }

  private readonly radius = computed(() => Math.max(36, Math.min(this.width() / 14 - 10, 120)));
  protected readonly height = computed(() => (this.shape() === 'band' ? 250 : Math.round(26 + 2 * this.radius() + 42)));

  protected readonly plannings = computed(() => this.store.plannings.rows().filter((p) => (p.soll ?? 0) > 0));
  protected readonly planningName = computed(() => this.store.plannings.rows().find((p) => p.shift_planning_sk === this.store.planning())?.planning_name ?? '–');
  protected readonly planningNote = computed(() =>
    this.store.planningPick() ? 'SOLL-Planung von Hand gewählt.' : 'SOLL-Planung vorausgewählt nach Name («ab August»); das Modell kennt keine Gültigkeit der fünf Planungen.');

  /** SOLL occupancy of the chosen planning, restricted to the worker type of the page filter */
  private readonly soll = computed(() => {
    const w = this.store.worker();
    const rows = this.store.soll.rows().filter((r) => w === 'alle' || (w === 'disponent' ? r.worker_type_name === DISP : r.worker_type_name !== DISP));
    return sollOccupancy(rows);
  });

  /** staffed planned shifts in the window (or the story week), averaged per weekday occurrence */
  private readonly plan = computed(() => {
    const stand = this.store.stand.rows()[0];
    const week = this.store.storyWeek();
    let from = dayMs(week?.from ?? this.store.from())!;
    let to = dayMs(week?.to ?? this.store.to())!;
    const lo = dayMs(stand?.erster_plantag);
    const hi = dayMs(stand?.letzter_plantag);
    if (lo != null) from = Math.max(from, lo);
    if (hi != null) to = Math.min(to, hi);
    const iv: [number, number][] = [];
    for (const r of this.store.shifts.rows()) {
      if (!r.person_sk) continue;
      const d = dayMs(r.planned_date)!;
      if (d < from || d > to) continue;
      const s = localMs(r.planned_start);
      const e = localMs(r.planned_end);
      if (s != null && e != null) iv.push([s, e]);
    }
    return averagePerOccurrence(plannedOccupancy(iv), weekdayCounts(from, to));
  });

  private readonly gaps = computed(() => {
    const s = this.soll();
    const p = this.plan();
    return Array.from({ length: 168 }, (_, i) => Math.max(0, s[i] - p[i]));
  });

  protected readonly sub = computed(() => {
    const g = this.gaps();
    const hours = g.filter((x) => x >= EPS).length;
    if (!this.store.soll.result()) return '';
    if (!hours) return 'Keine Stunde der Musterwoche unter SOLL.';
    let worst = 0;
    g.forEach((x, i) => (x > g[worst] ? (worst = i) : null));
    return `${hours} von 168 Wochenstunden unter SOLL, am stärksten ${DAY_SHORT[Math.floor(worst / 24)]} ${String(worst % 24).padStart(2, '0')} h (−${num(g[worst], 1)} Schichten)`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const c = this.colors();
    const soll = this.soll();
    const plan = this.plan();
    const gap = this.gaps();
    const band = this.shape() === 'band';
    const max = Math.max(1, ...soll, ...plan);
    const W = this.width();
    const cell = W / 7;
    const r = this.radius();
    const series: object[] = [];
    const polar: object[] = [];
    const angleAxis: object[] = [];
    const radiusAxis: object[] = [];
    const graphic: object[] = [];
    const tip = (i: number, h: number) => {
      const k = i * 24 + h;
      return ttHead(`${DAYS[i]} ${String(h).padStart(2, '0')}–${String(h + 1).padStart(2, '0')} h`)
        + ttRow(null, 'SOLL', num(soll[k], 1)) + ttRow(c.plan, 'besetzt geplant (Ø)', num(plan[k], 1))
        + (gap[k] >= EPS ? ttRow(c.gap, 'Unterdeckung', num(gap[k], 1)) : '');
    };
    for (let i = 0; i < 7; i++) {
      const hours = Array.from({ length: 24 }, (_, h) => h);
      const coord = band ? { coordinateSystem: 'cartesian2d', xAxisIndex: 0, yAxisIndex: 0 } : { coordinateSystem: 'polar', polarIndex: i };
      const val = (arr: ArrayLike<number>, h: number) => (band ? [i * 24 + h, arr[i * 24 + h]] : arr[i * 24 + h]);
      // two bar positions per category in both shapes (stack p = plan + gap, stack soll = outline), overlaid
      // ids differ per shape (echarts reused the first series' polar sectors when only the coordinate system
      // changed); seriesKey pairs the bars across the shapes for the morph
      const common = { ...coord, animationDurationUpdate: 900, animationEasingUpdate: 'cubicInOut', barGap: '-100%', barCategoryGap: band ? '10%' : '6%' };
      const ut = (k: string) => ({ id: `${k}-${i}-${band ? 'band' : 'uhr'}`, universalTransition: { enabled: true, seriesKey: `${k}-${i}` } });
      series.push(
        { ...common, ...ut('plan'), name: 'besetzt geplant', type: 'bar', stack: 'p', data: hours.map((h) => val(plan, h)),
          itemStyle: { color: c.plan } },
        { ...common, ...ut('gap'), name: 'Unterdeckung', type: 'bar', stack: 'p', data: hours.map((h) => val(gap.map((g) => (g >= EPS ? g : 0)), h)),
          itemStyle: { color: c.gap, decal: DECAL.gap } },
        { ...common, ...ut('soll'), name: 'SOLL', type: 'bar', stack: 'soll', z: 3, silent: true, data: hours.map((h) => val(soll, h)),
          itemStyle: { color: 'transparent', borderColor: t.ink, borderWidth: 1.2 } },
      );
      // both coordinate systems exist in both shapes; the unused one is hidden
      const cx = cell * i + cell / 2;
      polar.push({ center: [cx, 26 + r], radius: band ? [0, 1] : [Math.round(r * 0.18), r] });
      angleAxis.push({
        polarIndex: i, type: 'category', data: hours, startAngle: 90, clockwise: true, boundaryGap: true, show: !band,
        axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: t.muted, fontSize: 10, interval: 5, formatter: (v: string) => (Number(v) % 6 === 0 ? v : '') },
      });
      radiusAxis.push({ polarIndex: i, type: 'value', max, show: !band, axisLine: { show: false }, axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: !band, lineStyle: { color: t.grid } }, splitNumber: 2 });
      const dayGap = gap.slice(i * 24, i * 24 + 24).reduce((a, x) => a + (x >= EPS ? x : 0), 0);
      graphic.push(
        { id: `day-${i}`, type: 'text', left: cx - 40, top: 0, invisible: band, style: { text: DAY_SHORT[i], width: 80, align: 'center', fill: t.ink, font: `600 15px ${FONT_NUM}` } },
        { id: `foot-${i}`, type: 'text', left: cx - 60, top: 26 + 2 * r + 20, invisible: band, style: { text: dayGap >= EPS ? `−${num(dayGap, 1)} Schicht-h` : 'gedeckt', width: 120, align: 'center', fill: dayGap >= EPS ? t.ink2 : t.muted, font: `12px ${FONT_NUM}` } },
      );
    }
    return {
      aria: ariaDecal(), // explicit decal on the shortfall only
      animationDurationUpdate: 900,
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: { seriesId: string; dataIndex: number }) => tip(Number(p.seriesId.split('-')[1]), p.dataIndex),
      },
      graphic: { elements: graphic },
      polar, angleAxis, radiusAxis,
      grid: band ? { left: 36, right: 8, top: 16, bottom: 28 } : { left: 0, top: 0, width: 1, height: 1 },
      xAxis: {
        type: 'category', data: Array.from({ length: 168 }, (_, k) => k), show: band,
        axisLabel: { interval: (k: number) => k % 24 === 0, formatter: (v: string) => DAY_SHORT[Number(v) / 24] ?? '', color: t.ink2, fontFamily: FONT_NUM, align: 'left' },
        splitLine: { show: band, interval: (k: number) => k % 24 === 0, lineStyle: { color: t.axis } }, axisTick: { show: false },
      },
      yAxis: { type: 'value', name: 'Schichten', show: band, nameTextStyle: { color: t.muted }, splitLine: { show: band, lineStyle: { color: t.grid } } },
      series,
    };
  });
}
