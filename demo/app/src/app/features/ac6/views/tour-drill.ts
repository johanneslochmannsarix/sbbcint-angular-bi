import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, minutes, num } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac6Colors, fahrenColor } from '../data/palette';
import { Ac6Store } from '../data/store';
import { TourRow } from '../data/types';
import { clock, weekTime } from '../data/week';

const H = 3_600_000;

/**
 * View 6 - one planned tour. Reached from any view that picks a Tourstandort (heatmap cell, sunburst, diff bar,
 * plan-vs-disposition dumbbell, the breadcrumb): the tours of that Tourstandort in the version (sorted by start in
 * the pattern week, narrowed by Personaltyp / Tätigkeit / weekday), and for the picked tour a Gantt of its elements
 * on the pattern-week clock (offsets from Monday 00:00, no calendar date). Bars coloured by the SaxMS flag Fahren.
 * The tour name is free text and masked (T-…); the drill passes the tour id only.
 */
@Component({
  selector: 'ac6-tour-drill',
  styleUrl: './tour-drill.css',
  encapsulation: ViewEncapsulation.None,
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card [heading]="heading()" [q]="store.touren" idleText="Einen Tourstandort wählen (Raster, Ringe, Vergleich), dann eine Tour."
              emptyNote="Unter diesem Filter plant die Version an diesem Tourstandort keine Tour.">
      <p class="ac6-answer">{{ answer() }}</p>
      <div class="ac6-split ac6-split-drill">
        <div class="ac6-list" role="listbox" aria-label="Touren des Tourstandorts">
          <table class="tbl ac6-tbl">
            <thead><tr><th>Tour</th><th>Beginn</th><th>Ende</th><th class="num">Dauer</th><th class="num">Elemente</th><th class="num">Fahren</th></tr></thead>
            <tbody>
              @for (r of store.touren.rows(); track r.tour_id) {
                <tr role="option" tabindex="0" [attr.aria-selected]="store.tour() === r.tour_id" [class.is-sel]="store.tour() === r.tour_id"
                    (click)="pick(r.tour_id)" (keydown.enter)="pick(r.tour_id)" (keydown.space)="pick(r.tour_id); $event.preventDefault()">
                  <td>{{ r.tour ?? '–' }}</td><td>{{ wt(r.start_ms) }}</td><td>{{ wt(r.ende_ms) }}</td>
                  <td class="num">{{ h(r.dauer_h) }}</td><td class="num">{{ n(r.elemente) }}</td><td class="num">{{ h(r.fahren_h) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div>
          @if (store.tour()) {
            <div echarts class="chart" [style.height.px]="ganttHeight()" [options]="gantt()!" [theme]="theme.echartsTheme()"
                 aria-label="Elemente der gewählten Tour auf der Uhr der Musterwoche"></div>
            <p class="ac6-note">{{ tourNote() }}</p>
          } @else {
            <p class="ac6-empty">Eine Tour in der Liste wählen: ihre Elemente erscheinen hier als Zeitleiste.</p>
          }
        </div>
      </div>
    </app-card>
  `,
})
export class TourDrillView {
  protected readonly store = inject(Ac6Store);
  protected readonly theme = inject(ThemeService);
  protected readonly wt = weekTime;
  protected readonly h = (v: number | null) => hours(v, 1);
  protected readonly n = (v: number | null) => num(v);

  protected readonly heading = computed(() => (this.store.standortName() ? `Wie sieht eine Tour in ${this.store.standortName()} aus?` : 'Wie sieht eine geplante Tour aus?'));

  protected readonly answer = computed(() => {
    const rs = this.store.touren.rows();
    if (!rs.length) return '';
    const dur = rs.map((r) => r.dauer_h ?? 0).sort((a, b) => a - b);
    const med = dur[Math.floor(dur.length / 2)];
    const els = rs.map((r) => r.elemente ?? 0);
    return `${num(rs.length)} Touren, im Median ${hours(med, 1)} lang, mit ${num(Math.min(...els))} bis ${num(Math.max(...els))} Elementen.`;
  });

  private readonly elements = computed<TourRow[]>(() => [...this.store.tourQ.rows()].sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0)));
  protected readonly ganttHeight = computed(() => Math.max(180, this.elements().length * 24 + 56));

  protected readonly tourNote = computed(() => {
    const e = this.elements();
    if (!e.length) return '';
    const f = e[0];
    const az = e.reduce((s, x) => s + (x.arbeitszeit_min ?? 0), 0);
    const dur = e.reduce((s, x) => s + (x.dauer_min ?? 0), 0);
    return `${f.tour ?? 'Tour'} · ${f.personaltyp ?? '–'} · ${weekTime(f.tour_start_ms)} bis ${weekTime(f.tour_ende_ms)}. ` +
      `Elemente zusammen ${minutes(dur)}, Arbeitszeit laut Quelle ${minutes(az)} (die Regel der Tour-Arbeitszeit ist nicht exportiert).`;
  });

  protected readonly gantt = computed<EChartsCoreOption | null>(() => {
    const els = this.elements();
    if (!els.length) return null;
    const t = this.theme.tokens();
    const c = ac6Colors(this.theme.mode());
    const lo = Math.min(...els.map((e) => e.start_ms ?? Infinity), els[0].tour_start_ms ?? Infinity);
    const hi = Math.max(...els.map((e) => e.ende_ms ?? -Infinity), els[0].tour_ende_ms ?? -Infinity);
    const pad = Math.max(15 * 60_000, (hi - lo) * 0.03);
    const tip = (e: TourRow) => ttHead(e.taetigkeit ?? '(ohne Tätigkeit)') +
      ttRow(fahrenColor(c, e.fahren), 'Fahren (SaxMS)', e.fahren ?? '–') + ttRow(null, 'Zeit', `${weekTime(e.start_ms)} – ${clock(e.ende_ms)}`) +
      ttRow(null, 'Dauer', minutes(e.dauer_min)) + ttRow(null, 'Arbeitszeit laut Quelle', minutes(e.arbeitszeit_min)) +
      ttRow(null, 'von → nach', `${e.startbahnhof ?? '–'} → ${e.zielbahnhof ?? '–'}`) + ttRow(null, 'Zugnummer', e.zugnummer ?? '–') +
      ttRow(null, 'Kostenallokation', e.kostenallokation ?? '–');
    return {
      aria: ariaDecal(),
      tooltip: { confine: true, formatter: (p: { dataIndex: number }) => tip(els[p.dataIndex]) },
      grid: { left: 8, right: 16, top: 30, bottom: 8, outerBounds: { left: 8, right: 16, top: 30, bottom: 8 } },
      xAxis: {
        // ticks on whole hours of the pattern week: min / max snapped to the hour, step 1, 2, 3 or 6 h by span
        type: 'value', position: 'top', splitLine: { lineStyle: { color: t.grid } },
        min: Math.floor((lo - pad) / H) * H, max: Math.ceil((hi + pad) / H) * H,
        interval: [1, 2, 3, 6].map((s) => s * H).find((s) => (hi - lo) / s <= 8) ?? 12 * H,
        axisLabel: { color: t.muted, fontFamily: FONT_NUM, formatter: (v: number) => weekTime(v), hideOverlap: true },
      },
      yAxis: {
        type: 'category', inverse: true, data: els.map((e, i) => `${i + 1}. ${e.taetigkeit ?? '(ohne Tätigkeit)'}`),
        axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: t.ink2, width: 200, overflow: 'truncate', fontSize: 11.5 },
      },
      series: [{
        type: 'custom',
        encode: { x: [1, 2], y: 0 },
        data: els.map((e, i) => [i, e.start_ms ?? 0, e.ende_ms ?? e.start_ms ?? 0]),
        renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const i = api.value(0);
          const a = api.coord([api.value(1), i]);
          const b = api.coord([api.value(2), i]);
          const hgt = Math.min(16, api.size([0, 1])[1] * 0.62);
          const e = els[i];
          const w = Math.max(2, b[0] - a[0]);
          const text = w > 90 ? `${e.startbahnhof ?? ''} → ${e.zielbahnhof ?? ''}` : '';
          return {
            type: 'group', children: [
              { type: 'rect', shape: { x: a[0], y: a[1] - hgt / 2, width: w, height: hgt, r: 3 }, style: { fill: fahrenColor(c, e.fahren) } },
              ...(text ? [{ type: 'text', style: { x: a[0] + 6, y: a[1], text, fill: e.fahren ? '#ffffff' : t.ink, font: `11px ${FONT_NUM}`, verticalAlign: 'middle', width: w - 10, overflow: 'truncate' } }] : []),
            ],
          };
        },
      }],
    };
  });

  protected pick(id: string): void {
    this.store.tour.set(this.store.tour() === id ? null : id);
  }

  protected readonly escape = esc;
}
