import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { dateLong, hours, isoDay, monthLong, num } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { ChartResize } from '../../../shared/chart-resize';
import { GROUP_ORDER, OTHER_TOURS, Paint, groupKey, groupLabel, groupPaint, tourKeyOf, tourPaint, tourPalette } from '../data/colors';
import { AUDIENCE_LABEL, PeriodRow, summariseDays } from '../data/model';
import { Ac1Store, label, nextMonth } from '../data/store';

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** a cell's bar is full at this many planned hours */
const FULL_H = 12;

/**
 * Views 1 + 3: the month of the «ansehen als» person on the CALENDAR (dim_date), one cell per day: planned
 * hours (overlaps merged, clipped to the day) and a bar split by activity group (Ausbilder) or by tour
 * (Auszubildende, who have no activity in the export). Click a day -> day Gantt + map.
 * Replaces one page of «Plantafel Ausbilder Tagesraster» / «Plantafel Report Auszubildende».
 */
@Component({
  selector: 'ac1-month-calendar',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card [heading]="heading()" [sub]="sub()" [q]="store.monthTours"
      [forceEmpty]="!!store.monthTours.result() && store.focusMonthRows().length === 0"
      [emptyNote]="'Für diese Person ist in diesem Kalendermonat nichts geplant.'">
      <div card-tools class="cal-tools">
        <button type="button" class="btn btn-ghost" (click)="store.shiftMonth(-1)" aria-label="Vorheriger Monat">‹</button>
        <span class="cal-month">{{ monthText() }}</span>
        <button type="button" class="btn btn-ghost" (click)="store.shiftMonth(1)" aria-label="Nächster Monat">›</button>
      </div>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()" [theme]="theme.echartsTheme()"
        (chartClick)="pick($any($event))"></div>
      <div class="legend-inline cal-legend" aria-label="Farblegende">
        @for (k of legend(); track k.key) {
          <span><span class="key" [style.background]="k.paint.fill" [style.border]="k.paint.stroke ? '1px solid ' + k.paint.stroke : null"></span>{{ k.label }}</span>
        }
      </div>
      <p class="chart-note">Geplante Stunden je Kalendertag, Überschneidungen einmal gezählt; ein voller Balken = {{ full }} h. Einträge über den ganzen Tag (z. B. Ruhetage als Tour erfasst) heissen «ganztägig» und zählen nicht als Stunden. Periode = Kalendermonat, nicht der Monat aus dem Auftragsnamen (PLT-5).</p>
    </app-card>
  `,
  styles: [`
    .cal-tools { display: flex; align-items: center; gap: 4px; }
    .cal-month { min-width: 9.5em; text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; }
    .cal-legend { justify-content: flex-start; margin-top: 6px; }
  `],
})
export class MonthCalendarView {
  protected readonly store = inject(Ac1Store);
  protected readonly theme = inject(ThemeService);
  protected readonly full = FULL_H;

  private readonly isTrainee = computed(() => this.store.audience() === 'auszubildende');
  /** trainee views: colour by tour, palette fixed for the month on screen */
  private readonly palette = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.store.focusMonthRows()) {
      const k = r.tourbezeichnung ?? '(ohne Tourbezeichnung)';
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return tourPalette(counts);
  });
  private readonly keyOf = computed<(r: PeriodRow) => string>(() => {
    if (!this.isTrainee()) return (r) => groupKey(r.activity_group);
    const pal = this.palette();
    return (r) => tourKeyOf(r.tourbezeichnung, pal);
  });
  private readonly paintOf = computed<(k: string) => Paint>(() => {
    const t = this.theme.tokens();
    if (!this.isTrainee()) return (k) => groupPaint(k, t);
    const pal = this.palette();
    return (k) => tourPaint(k, pal, t);
  });
  private readonly order = computed(() => (this.isTrainee() ? [...this.palette().keys(), OTHER_TOURS] : [...GROUP_ORDER]));

  readonly days = computed(() => summariseDays(this.store.focusMonthRows(), this.keyOf()));

  protected readonly legend = computed(() => {
    const present = new Set<string>();
    for (const d of this.days().values()) {
      for (const k of d.byKey.keys()) present.add(k);
      if (d.fullDay) present.add(d.fullDay);
    }
    const paint = this.paintOf();
    return this.order()
      .filter((k) => present.has(k))
      .map((k) => ({ key: k, label: this.isTrainee() ? k : groupLabel(k), paint: paint(k) }));
  });

  protected readonly heading = computed(() => {
    const f = this.store.focus();
    const who = f ? label(f.person) : '…';
    return `Monat von ${who}`;
  });
  protected readonly monthText = computed(() => monthLong(this.store.month()));
  protected readonly sub = computed(() => {
    let h = 0;
    let n = 0;
    for (const d of this.days().values()) {
      h += d.hours;
      if (d.tours) n++;
    }
    return `${AUDIENCE_LABEL[this.store.audience()]}: ${num(n)} Tage mit Plan, ${hours(h, 0)} geplant. Tag anklicken für Tagesplan und Karte.`;
  });

  protected readonly height = computed(() => {
    const m = new Date(this.store.month());
    const firstWd = (m.getDay() + 6) % 7;
    const len = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    return 30 + Math.ceil((firstWd + len) / 7) * 66;
  });

  protected readonly options = computed<EChartsCoreOption>(() => {
    const t = this.theme.tokens();
    const m = this.store.month();
    const days = this.days();
    const paint = this.paintOf();
    const order = this.order();
    const sel = this.store.day();
    const end = nextMonth(m);
    const data: [string, number][] = [];
    for (let d = m; d < end; d = new Date(new Date(d).getFullYear(), new Date(d).getMonth(), new Date(d).getDate() + 1).getTime()) {
      data.push([isoDay(d), d]);
    }
    const isTrainee = this.isTrainee();
    return {
      animation: false,
      tooltip: {
        formatter: (p: { value: [string, number] }) => {
          const ms = p.value[1];
          const s = days.get(ms);
          if (!s) return ttHead(dateLong(ms)) + '<div style="opacity:.7">Nichts geplant</div>';
          let html = ttHead(dateLong(ms)) + ttRow(null, 'Geplant', hours(s.hours)) + ttRow(null, 'Touren', num(s.tours));
          if (s.fullDay) html += ttRow(paint(s.fullDay).fill, 'ganztägiger Eintrag', isTrainee ? s.fullDay : groupLabel(s.fullDay));
          for (const k of order) {
            const v = s.byKey.get(k);
            if (v) html += ttRow(paint(k).fill, isTrainee ? k : groupLabel(k), hours(v));
          }
          if (s.cohorts.size) html += `<div style="opacity:.75;margin-top:4px">Auftrag: ${esc([...s.cohorts].join(', '))}</div>`;
          return html + '<div style="opacity:.7;margin-top:4px">Klicken: Tagesplan und Karte</div>';
        },
      },
      calendar: {
        orient: 'vertical',
        range: [isoDay(m), isoDay(end - 1)],
        top: 22, left: 4, right: 4, bottom: 4,
        cellSize: ['auto', 66],
        splitLine: { show: false },
        itemStyle: { borderColor: t.grid, borderWidth: 1 }, // cells transparent (theme), so the custom series shows
        dayLabel: { firstDay: 1, nameMap: WEEKDAYS, color: t.muted, fontSize: 11, position: 'start', margin: 6 },
        monthLabel: { show: false },
        yearLabel: { show: false },
      },
      series: [{
        type: 'custom',
        coordinateSystem: 'calendar',
        data,
        renderItem: (params: any, api: any) => {
          const ms = api.value(1) as number;
          const [cx, cy] = api.coord(api.value(0));
          const cw = params.coordSys.cellWidth as number;
          const ch = params.coordSys.cellHeight as number;
          const x0 = cx - cw / 2;
          const y0 = cy - ch / 2;
          const s = days.get(ms);
          // the whole cell is the hit area (tooltip + click), not just the text and the bar
          const children: any[] = [{ type: 'rect', shape: { x: x0, y: y0, width: cw, height: ch }, style: { fill: 'rgba(0,0,0,0)' } }];
          if (sel === ms) {
            children.push({ type: 'rect', shape: { x: x0 + 1, y: y0 + 1, width: cw - 2, height: ch - 2, r: 3 },
              style: { fill: 'transparent', stroke: t.ink, lineWidth: 2 } });
          }
          children.push({ type: 'text', style: { x: x0 + 6, y: y0 + 5, text: String(new Date(ms).getDate()),
            fill: s ? t.ink2 : t.muted, font: '11px ' + 'Segoe UI', verticalAlign: 'top' } });
          if (s && !s.byKey.size && s.fullDay) {
            const p = paint(s.fullDay);
            children.push({ type: 'text', style: { x: x0 + cw - 6, y: y0 + 6, text: 'ganztägig', align: 'right',
              verticalAlign: 'top', fill: t.ink2, font: '11px Segoe UI' } });
            children.push({ type: 'rect', shape: { x: x0 + 6, y: y0 + ch - 18, width: cw - 12, height: 10, r: 2 },
              style: { fill: p.fill, stroke: p.stroke ?? undefined, lineWidth: p.stroke ? 1 : 0, opacity: 0.45 } });
          } else if (s) {
            children.push({ type: 'text', style: { x: x0 + cw - 6, y: y0 + 5, text: num(s.hours, 1) + ' h', align: 'right',
              verticalAlign: 'top', fill: t.ink, font: '600 13px Bahnschrift, Segoe UI' } });
            const barW = cw - 12;
            let x = x0 + 6;
            const total = [...s.byKey.values()].reduce((a, b) => a + b, 0) || 1;
            const scale = Math.min(1, s.hours / FULL_H);
            for (const k of order) {
              const v = s.byKey.get(k);
              if (!v) continue;
              const w = Math.max(2, (barW * scale * v) / total);
              const p = paint(k);
              children.push({ type: 'rect', shape: { x, y: y0 + ch - 18, width: Math.max(1, w - 2), height: 10, r: 2 },
                style: { fill: p.fill, stroke: p.stroke ?? undefined, lineWidth: p.stroke ? 1 : 0 } });
              x += w;
            }
            if (s.tours > 1) {
              children.push({ type: 'text', style: { x: x0 + 6, y: y0 + ch - 24, text: `${s.tours} Touren`, fill: t.muted,
                font: '10px Segoe UI', verticalAlign: 'bottom' } });
            }
          }
          return { type: 'group', children };
        },
      }],
    };
  });

  protected pick(e: { value?: [string, number] }): void {
    if (e.value) this.store.openDay(e.value[1]);
  }
}
