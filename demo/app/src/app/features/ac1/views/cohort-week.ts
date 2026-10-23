import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { addDays, dateLong, dateShort, hours, num } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ttHead, ttRow } from '../../../shared/chart-opts';
import { ChartResize } from '../../../shared/chart-resize';
import { OTHER_TOURS, inkOn, tourKeyOf, tourPaint, tourPalette } from '../data/colors';
import { cohortOf, summariseDays } from '../data/model';
import { Ac1Store, label } from '../data/store';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/**
 * View 4: one cohort (the training order without its month suffix, `dor_name`) for one week, trainee x day.
 * Cell colour = the tour with the most planned hours that day (top 6 tours of the cohort-week, the rest
 * «Weitere Touren»; trainees carry no activity in the export), text = planned hours. Click a cell -> that
 * trainee's day plan (view 3). New: the RDLs have no cohort view.
 */
@Component({
  selector: 'ac1-cohort-week',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Kohorte, Woche" [sub]="sub()" [q]="store.weekTours"
      [forceEmpty]="!!store.weekTours.result() && trainees().length === 0"
      emptyNote="In dieser Woche hat diese Kohorte keinen Plan.">
      <div card-tools class="cw-tools">
        <select class="select" aria-label="Kohorte" [value]="store.cohort() ?? ''" (change)="store.cohort.set($any($event.target).value)">
          @for (c of store.cohorts(); track c.name) {
            <option [value]="c.name">{{ c.name }} ({{ c.size }})</option>
          }
        </select>
        <button type="button" class="btn btn-ghost" (click)="shift(-7)" aria-label="Vorherige Woche">‹</button>
        <span class="cw-week">{{ weekText() }}</span>
        <button type="button" class="btn btn-ghost" (click)="shift(7)" aria-label="Nächste Woche">›</button>
      </div>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()" [theme]="theme.echartsTheme()" (chartClick)="pick($any($event))"></div>
      <div class="legend-inline cw-legend">
        @for (k of legend(); track k.key) {
          <span><span class="key" [style.background]="k.fill"></span>{{ k.key }}</span>
        }
      </div>
      <p class="chart-note">Kohorte = Auftrag ohne Monatsangabe. Sie sagt, wer im gleichen Ausbildungsauftrag geplant ist, nicht wer wen ausbildet.</p>
    </app-card>
  `,
  styles: [`
    .cw-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .cw-week { min-width: 11em; text-align: center; font-variant-numeric: tabular-nums; }
    .cw-legend { justify-content: flex-start; margin-top: 4px; }
  `],
})
export class CohortWeekView {
  protected readonly store = inject(Ac1Store);
  protected readonly theme = inject(ThemeService);

  private readonly cohortRows = computed(() => {
    const c = this.store.cohort();
    return this.store.weekTours.rows().filter((r) => cohortOf(r.dor_name) === c && this.store.people().get(r.person_sk)?.audiences.has('auszubildende'));
  });
  readonly trainees = computed(() => [...new Set(this.cohortRows().map((r) => r.person_sk))].sort((a, b) => label(this.store.personOf(a)).localeCompare(label(this.store.personOf(b)))));
  private readonly palette = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.cohortRows()) counts.set(r.tourbezeichnung ?? '(ohne Tourbezeichnung)', (counts.get(r.tourbezeichnung ?? '(ohne Tourbezeichnung)') ?? 0) + 1);
    return tourPalette(counts);
  });
  /** person -> day -> summary by tour key */
  private readonly grid = computed(() => {
    const pal = this.palette();
    const out = new Map<string, ReturnType<typeof summariseDays>>();
    for (const p of this.trainees()) {
      out.set(p, summariseDays(this.cohortRows().filter((r) => r.person_sk === p), (r) => tourKeyOf(r.tourbezeichnung, pal)));
    }
    return out;
  });
  protected readonly legend = computed(() => {
    const t = this.theme.tokens();
    const pal = this.palette();
    return [...pal.keys(), OTHER_TOURS].map((k) => ({ key: k, fill: tourPaint(k, pal, t).fill }));
  });

  protected readonly weekText = computed(() => `${dateShort(this.store.week())}–${dateShort(addDays(this.store.week(), 6))}`);
  protected readonly sub = computed(() => `${num(this.trainees().length)} Auszubildende mit Plan in diesem Auftrag. Zelle anklicken öffnet den Tagesplan.`);
  protected readonly height = computed(() => 50 + Math.max(2, this.trainees().length) * 34);

  protected shift(days: number): void {
    this.store.week.set(addDays(this.store.week(), days));
  }

  protected readonly options = computed<EChartsCoreOption>(() => {
    const t = this.theme.tokens();
    const people = this.trainees();
    const grid = this.grid();
    const pal = this.palette();
    const w0 = this.store.week();
    const days = Array.from({ length: 7 }, (_, i) => addDays(w0, i));
    const data: [number, number, number][] = [];
    people.forEach((p, y) => days.forEach((d, x) => data.push([x, y, d])));
    const store = this.store;
    const cell = (x: number, y: number) => grid.get(people[y])?.get(days[x]);
    return {
      animation: false,
      grid: { left: 8, right: 8, top: 24, bottom: 4, outerBounds: { left: 8, right: 8, top: 24, bottom: 4 } },
      tooltip: {
        formatter: (p: { value: [number, number, number] }) => {
          const [x, y] = p.value;
          const s = cell(x, y);
          let html = ttHead(`${label(store.personOf(people[y]))}, ${dateLong(days[x])}`);
          if (!s) return html + '<div style="opacity:.7">nichts geplant</div>';
          html += ttRow(null, 'Geplant', hours(s.hours));
          if (s.fullDay) html += ttRow(tourPaint(s.fullDay, pal, t).fill, 'ganztägiger Eintrag', s.fullDay);
          for (const [k, v] of [...s.byKey.entries()].sort((a, b) => b[1] - a[1])) html += ttRow(tourPaint(k, pal, t).fill, k, hours(v));
          return html + '<div style="opacity:.7;margin-top:4px">Klicken: Tagesplan</div>';
        },
      },
      xAxis: { type: 'category', position: 'top', data: days.map((d, i) => `${WD[i]} ${dateShort(d)}`), axisTick: { show: false }, axisLine: { show: false } },
      yAxis: {
        type: 'category', inverse: true, data: people.map((p) => label(store.personOf(p))),
        axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: t.ink2, width: 150, overflow: 'truncate' },
      },
      series: [{
        type: 'custom',
        data,
        encode: { x: 0, y: 1 },
        renderItem: (params: any, api: any) => {
          const x = api.value(0);
          const y = api.value(1);
          const [cx, cy] = api.coord([x, y]);
          const [w, h] = api.size([1, 1]);
          const s = cell(x, y);
          const r = { x: cx - w / 2 + 2, y: cy - h / 2 + 2, width: w - 4, height: h - 4, r: 4 };
          if (!s) return { type: 'rect', shape: r, style: { fill: t.surface, stroke: t.grid, lineWidth: 1 } };
          const allDay = !s.byKey.size && !!s.fullDay;
          const top = allDay ? s.fullDay! : ([...s.byKey.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? OTHER_TOURS);
          const fill = tourPaint(top, pal, t).fill;
          return {
            type: 'group', children: [
              { type: 'rect', shape: r, style: { fill, opacity: allDay ? 0.45 : 1 } },
              { type: 'text', style: { x: cx, y: cy, text: allDay ? 'ganztägig' : `${num(s.hours, 1)} h`, align: 'center', verticalAlign: 'middle',
                fill: allDay ? t.ink : inkOn(fill, t), font: `${allDay ? 400 : 600} 11.5px Segoe UI` } },
            ],
          };
        },
      }],
    };
  });

  protected pick(e: { value?: [number, number, number] }): void {
    if (!e.value) return;
    const p = this.trainees()[e.value[1]];
    if (p) this.store.openPerson(p, 'auszubildende', e.value[2]);
  }
}
