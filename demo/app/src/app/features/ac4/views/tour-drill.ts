import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, dateOnly, hours, localMs, minutes, num, pct, timeLocal } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac4Colors, fahrenColor } from '../data/palette';
import { Ac4Store, monthLabel } from '../data/store';
import { TourRow } from '../data/types';

type IstFilter = 'alle' | 'mit' | 'ohne';
const PAGE = 150;

/**
 * View 6 - Tour drill-down, the end of the path Firma -> Tourstandort -> Tour. Left: the tours of the picked
 * Tourstandort in the picked month (the report's drillthrough table, no person column), with their derived
 * Ist coverage and angerechnete Zeit. Right: one tour as a Gantt of its elements - plan bar (colour = Fahren)
 * and, where CargoControl reported it, the Ist bar underneath (Ocker). The derived Tour-Ist window is drawn
 * as a band and named for what it is: the reported period, not the shift's begin and end (F4).
 */
@Component({
  selector: 'ac4-tour-drill',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'ac4-tour' },
  styles: [`
    :host { display: block; scroll-margin-top: 150px; }
    .ac4-drill { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); gap: 16px; align-items: start; }
    .ac4-tour-list { max-height: 560px; overflow: auto; }
    .ac4-tour-list .tbl td { padding: 4px 8px; }
    .ac4-mono { font-family: var(--ac4-num); color: var(--ink-2); }
    .ac4-more { margin: 8px 0 0; }
    .ac4-pill { font-size: 11.5px; padding: 0 6px; border-radius: 3px; border: 1px solid var(--rule-strong); color: var(--ink-2); white-space: nowrap; }
    .ac4-pill[data-a="alle Fahrelemente"], .ac4-pill[data-a="alle Elemente"] { border-color: #b5771c; color: var(--ink); }
    .ac4-key-band { background: transparent; border: 1px dashed #b5771c; box-sizing: border-box; }
    .ac4-prompt { padding: 16px 18px; border-style: dashed; }
    .ac4-prompt p { max-width: 80ch; margin: 6px 0 0; }
    @media (max-width: 1000px) { .ac4-drill { grid-template-columns: minmax(0, 1fr); } }
  `],
  template: `
    @if (!store.standort() || !store.month()) {
      <section class="card ac4-prompt">
        <h2 class="ac4-h2">Was steckt in einer einzelnen Tour?</h2>
        <p class="muted">Einen Tourstandort in der Übersicht anklicken und einen Planmonat wählen: dann erscheinen hier seine Touren, und jede Tour öffnet sich als Ablauf ihrer Tourelemente mit Plan und, wo vorhanden, Ist. Ein Punkt im Plan-Ist-Diagramm führt direkt zu seiner Tour.</p>
      </section>
    } @else {
      <section class="ac4-drill">
        <app-card [heading]="'Touren in ' + (store.standortName() ?? '') + ', ' + monthText()" [q]="store.touren"
          emptyNote="Keine Touren unter diesem Filter.">
          <div card-tools class="seg seg-sm" role="group" aria-label="Ist-Abdeckung">
            <button type="button" [attr.aria-pressed]="ist() === 'alle'" (click)="ist.set('alle')">alle</button>
            <button type="button" [attr.aria-pressed]="ist() === 'mit'" (click)="ist.set('mit')">mit Ist</button>
            <button type="button" [attr.aria-pressed]="ist() === 'ohne'" (click)="ist.set('ohne')">ohne Ist</button>
          </div>
          <p class="ac4-answer">{{ listAnswer() }}</p>
          <div class="table-wrap ac4-tour-list">
            <table class="tbl tbl-click">
              <thead><tr><th>Tour</th><th>Tag</th><th class="r">Elemente</th><th class="r">Plandauer</th><th>Ist</th><th class="r">angerechnet</th></tr></thead>
              <tbody>
                @for (r of shown(); track r.tour_id) {
                  <tr [class.is-selected]="r.tour_id === store.tour()" (click)="store.tour.set(r.tour_id)" tabindex="0" (keydown.enter)="store.tour.set(r.tour_id)">
                    <td class="ac4-mono" [title]="r.personaltyp_tour ?? ''">{{ r.tour ?? '–' }}</td>
                    <td>{{ day(r.tour_plandatum) }} {{ time(r.tour_planbeginn) }}</td>
                    <td class="r">{{ r.tourelemente }}</td>
                    <td class="r">{{ hrs(r.plandauer_h) }}</td>
                    <td><span class="ac4-pill" [attr.data-a]="r.abdeckung">{{ abdeckung(r.abdeckung) }}</span></td>
                    <td class="r">{{ r.anger_min == null ? '–' : hrs(r.anger_min / 60) }}</td>
                  </tr>
                }
              </tbody>
            </table>
            @if (filtered().length > limit()) {
              <button type="button" class="btn ac4-more" (click)="limit.set(limit() + 500)">weitere {{ filtered().length - limit() }} Touren zeigen</button>
            }
          </div>
        </app-card>

        <app-card [heading]="tourHeading()" [q]="store.tourQ" idleText="Eine Tour in der Liste anklicken.">
          <div card-tools>
            <button type="button" class="btn btn-ghost" (click)="store.tour.set(null)" [disabled]="!store.tour()">Tour schliessen</button>
          </div>
          @if (head(); as h) {
            <dl class="ac4-facts ac4-facts-tight">
              <div><dt>Tourstandort</dt><dd>{{ h.tourstandort }}</dd></div>
              <div><dt>Personaltyp</dt><dd>{{ h.personaltyp_tour }}</dd></div>
              <div><dt>Plan</dt><dd>{{ time(h.tour_planbeginn) }} – {{ time(h.tour_planende) }}</dd></div>
              <div><dt>Ist (aus Elementen)</dt><dd>{{ h.tour_istbeginn ? time(h.tour_istbeginn) + ' – ' + time(h.tour_istende) : 'keine Ist-Daten' }}</dd></div>
              <div><dt>Abdeckung</dt><dd>{{ abdeckung(h.abdeckung) }}</dd></div>
              <div><dt>angerechnet</dt><dd>{{ h.anger_min == null ? 'nicht geliefert' : mins(h.anger_min) }}</dd></div>
            </dl>
          }
          <div echarts class="chart" [style.height.px]="ganttHeight()" [options]="gantt()!" [theme]="theme.echartsTheme()"></div>
          <div class="legend-inline ac4-legend">
            <span><i class="key" [style.background]="c().fahren"></i>Plan, Fahren = ja</span>
            <span><i class="key" [style.background]="c().plan"></i>Plan, Fahren = nein</span>
            <span><i class="key" [style.background]="c().ist"></i>Ist (rückgemeldet)</span>
            <span><i class="key ac4-key-band"></i>Ist-Zeitraum der Tour, aus den Elementen</span>
          </div>
          <p class="ac4-cover">Ist-Zeiten meldet CargoControl fast nur für Fahrten; Pausen, Wegzeiten und Reserven haben keins. Der Ist-Zeitraum der Tour ist früheste bis späteste rückgemeldete Zeit, nicht Dienstbeginn und -ende. Der Tourname ist ein Freitext und erscheint pseudonymisiert.</p>
        </app-card>
      </section>
    }
  `,
})
export class TourDrillView {
  protected readonly store = inject(Ac4Store);
  protected readonly theme = inject(ThemeService);
  protected readonly c = computed(() => ac4Colors(this.theme.mode()));
  protected readonly ist = signal<IstFilter>('alle');
  protected readonly limit = signal(PAGE);

  protected readonly monthText = computed(() => monthLabel(this.store.month()));
  protected readonly filtered = computed(() => {
    const f = this.ist();
    return this.store.touren.rows().filter((r) => f === 'alle' || (f === 'mit') === (r.abdeckung !== 'keine Ist-Daten'));
  });
  /** the first page, plus the open tour when it lies beyond it (story mode, a scatter point), so it stays visible */
  protected readonly shown = computed(() => {
    const all = this.filtered();
    const page = all.slice(0, this.limit());
    const t = this.store.tour();
    const open = t && !page.some((r) => r.tour_id === t) ? all.find((r) => r.tour_id === t) : undefined;
    return open ? [open, ...page] : page;
  });

  protected readonly listAnswer = computed(() => {
    const rows = this.store.touren.rows();
    if (!rows.length) return '';
    const mit = rows.filter((r) => r.abdeckung && r.abdeckung !== 'keine Ist-Daten').length;
    const alleFahr = rows.filter((r) => r.abdeckung === 'alle Fahrelemente').length;
    const anger = rows.filter((r) => r.anger_min != null).length;
    return `${num(rows.length)} Touren; ${num(mit)} mit Ist auf mindestens einem Element (${num(alleFahr)} auf allen Fahrelementen), ${pct(anger / rows.length)} mit angerechneter Zeit.`;
  });

  protected readonly head = computed<TourRow | null>(() => this.store.tourQ.rows()[0] ?? null);
  protected readonly tourHeading = computed(() => {
    const h = this.head();
    return h ? `Tour ${h.tour ?? ''}, ${dateOnly(h.tour_planbeginn)}` : 'Tour';
  });
  protected readonly ganttHeight = computed(() => Math.max(160, this.store.tourQ.rows().length * 26 + 50));

  protected readonly gantt = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.tourQ.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = this.c();
    const h = rows[0];
    const cats = rows.map((r) => `${r.element_nr ?? ''} ${r.taetigkeit ?? 'ohne Tätigkeit'}`);
    const data = rows.map((r, i) => [i, localMs(r.element_planbeginn), localMs(r.element_planende), localMs(r.element_istbeginn), localMs(r.element_istende)]);
    const ib = localMs(h.tour_istbeginn);
    const ie = localMs(h.tour_istende);
    return {
      aria: ariaDecal(),
      animation: false,
      grid: { left: 8, right: 16, top: 8, bottom: 28, outerBounds: { left: 8, right: 16, top: 8, bottom: 28 } },
      xAxis: { type: 'time', axisLabel: { formatter: (v: number) => timeLocal(v) }, splitLine: { show: true, lineStyle: { color: t.grid } } },
      yAxis: { type: 'category', data: cats, inverse: true, axisLabel: { color: t.ink2, width: 200, overflow: 'truncate' } },
      tooltip: {
        confine: true,
        formatter: (p: { dataIndex: number }) => {
          const r = rows[p.dataIndex];
          if (!r) return '';
          return ttHead(`${r.element_nr ?? ''} · ${r.taetigkeit ?? 'ohne Tätigkeit'}`) +
            ttRow(fahrenColor(c, r.fahren), 'Plan', `${timeLocal(localMs(r.element_planbeginn)!)} – ${timeLocal(localMs(r.element_planende)!)} (${num(r.plandauer_min)} min)`) +
            ttRow(c.ist, 'Ist', r.element_istbeginn ? `${timeLocal(localMs(r.element_istbeginn)!)} – ${timeLocal(localMs(r.element_istende)!)} (${num(r.istdauer_min)} min)` : 'nicht rückgemeldet') +
            ttRow(null, 'von → nach', `${r.startbahnhof ?? BLANK} → ${r.zielbahnhof ?? BLANK}`) + ttRow(null, 'Person', r.person_zuordnung ?? BLANK);
        },
      },
      series: [{
        type: 'custom',
        encode: { x: [1, 2, 3, 4], y: 0 },
        data,
        renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const i = api.value(0);
          const r = rows[i];
          const band = api.size([0, 1])[1];
          const kids: object[] = [];
          const [x0, y] = api.coord([api.value(1), i]);
          const [x1] = api.coord([api.value(2), i]);
          kids.push({ type: 'rect', shape: { x: x0, y: y - band * 0.36, width: Math.max(2, x1 - x0), height: band * 0.36, r: 2 }, style: { fill: fahrenColor(c, r.fahren) } });
          if (r.element_istbeginn && r.element_istende) {
            const [a] = api.coord([api.value(3), i]);
            const [b] = api.coord([api.value(4), i]);
            kids.push({ type: 'rect', shape: { x: a, y: y + band * 0.04, width: Math.max(2, b - a), height: band * 0.26, r: 2 }, style: { fill: c.ist } });
          }
          return { type: 'group', children: kids };
        },
        markArea: ib && ie ? { silent: true, itemStyle: { color: c.ist, opacity: 0.08, borderColor: c.ist, borderType: 'dashed', borderWidth: 1 }, data: [[{ xAxis: ib }, { xAxis: ie }]] } : undefined,
      }],
    };
  });

  protected abdeckung(a: string | null): string {
    return a === 'keine Ist-Daten' ? 'keine' : a === 'alle Fahrelemente' ? 'alle Fahrten' : a ?? BLANK;
  }
  protected day(v: string | null): string {
    return v ? dateOnly(v).slice(0, 6) : BLANK;
  }
  protected time(v: string | null): string {
    const ms = localMs(v);
    return ms == null ? BLANK : timeLocal(ms);
  }
  protected hrs(v: number | null): string {
    return hours(v, 1);
  }
  protected mins(v: number | null): string {
    return minutes(v);
  }
}
