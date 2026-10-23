import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac4Colors, fahrenColor } from '../data/palette';
import { Ac4Store, monthLabel } from '../data/store';
import { TaetRow } from '../data/types';

const TOP = 12;

/**
 * View 1 side panel / view 2: Plandauer per Tätigkeit (SaxMS label 1:1), colour = Fahren (ja Petrol, nein
 * Stahlblau, ohne Tätigkeit neutral) - the report's «Tätigkeiten nach Plandauer». Top 12, the rest folded
 * into one «übrige» bar (no generated hues). Clicking a bar filters every view by that Tätigkeit.
 */
@Component({
  selector: 'ac4-taetigkeiten',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wofür wird die Zeit geplant?" [q]="store.taetigkeiten">
      <p class="ac4-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))"></div>
      <div class="legend-inline ac4-legend">
        <span><i class="key" [style.background]="c().fahren"></i>Fahren = ja</span>
        <span><i class="key" [style.background]="c().plan"></i>Fahren = nein</span>
        <span><i class="key" [style.background]="c().neutral"></i>ohne Tätigkeit</span>
      </div>
      <p class="ac4-cover">«Fahren» ist das Hauptfahrt-Kennzeichen der Tätigkeit aus SaxMS. Kernleistung, Reserve und Dispo ordnet Finance in der eigenen Arbeitsmappe zu (ADR-046). Kilometer fehlen im Export.</p>
    </app-card>
  `,
})
export class TaetigkeitenView {
  protected readonly store = inject(Ac4Store);
  protected readonly theme = inject(ThemeService);
  protected readonly c = computed(() => ac4Colors(this.theme.mode()));

  private readonly sorted = computed(() => [...this.store.taetigkeiten.rows()].filter((r) => (r.plandauer_h ?? 0) > 0)
    .sort((a, b) => (b.plandauer_h ?? 0) - (a.plandauer_h ?? 0)));
  /** top 12 + one «übrige» roll-up of the returned additive hours / element counts (layout) */
  private readonly bars = computed(() => {
    const s = this.sorted();
    const top: (TaetRow & { rest?: number })[] = s.slice(0, TOP);
    const rest = s.slice(TOP);
    if (rest.length) {
      top.push({
        taetigkeit: `übrige ${rest.length}`, worker_activity_sk: null, fahren: '·', rest: rest.length,
        tourelemente: rest.reduce((x, r) => x + (r.tourelemente ?? 0), 0), plandauer_h: rest.reduce((x, r) => x + (r.plandauer_h ?? 0), 0),
        anteil_auswahl: rest.reduce((x, r) => x + (r.anteil_auswahl ?? 0), 0),
        elemente_mit_ist: rest.reduce((x, r) => x + (r.elemente_mit_ist ?? 0), 0), elemente_vergangen: rest.reduce((x, r) => x + (r.elemente_vergangen ?? 0), 0),
      });
    }
    return top;
  });
  protected readonly height = computed(() => Math.max(200, this.bars().length * 24 + 24));

  protected readonly answer = computed(() => {
    const rows = this.store.taetigkeiten.rows();
    const total = rows.reduce((s, r) => s + (r.plandauer_h ?? 0), 0);
    if (!total) return '';
    const ja = rows.filter((r) => r.fahren === 'ja').reduce((s, r) => s + (r.plandauer_h ?? 0), 0);
    const top = this.sorted()[0];
    return `Fahrten sind ${pct(ja / total, 1)} der Plandauer (${monthLabel(this.store.month())}); am meisten Zeit geht an «${top?.taetigkeit ?? 'ohne Tätigkeit'}» (${hours(top?.plandauer_h, 0)}).`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const bars = this.bars();
    if (!bars.length) return null;
    const t = this.theme.tokens();
    const c = this.c();
    const sel = this.store.taet();
    const order = [...bars].reverse();
    return {
      aria: ariaDecal(),
      animationDuration: 400,
      grid: { left: 4, right: 56, top: 4, bottom: 4, outerBounds: { left: 4, right: 56, top: 4, bottom: 4 } },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: order.map((r) => r.taetigkeit ?? 'ohne Tätigkeit'), axisLabel: { color: t.ink2, width: 150, overflow: 'truncate' } },
      tooltip: {
        confine: true,
        formatter: (p: { dataIndex: number }) => {
          const r = order[p.dataIndex];
          return ttHead(r.taetigkeit ?? 'ohne Tätigkeit') + ttRow(fahrenColor(c, r.fahren), 'Fahren', r.fahren ?? '–') +
            ttRow(null, 'Plandauer', hours(r.plandauer_h, 0)) + ttRow(null, 'Tourelemente', num(r.tourelemente)) +
            ttRow(null, 'Anteil an Auswahl', pct(r.anteil_auswahl, 1)) +
            ttRow(c.ist, 'Ist erfasst (vergangene Elemente)', pct(r.elemente_vergangen ? (r.elemente_mit_ist ?? 0) / r.elemente_vergangen : null, 1));
        },
      },
      series: [{
        type: 'bar', barMaxWidth: 14, cursor: 'pointer',
        data: order.map((r) => ({
          value: r.plandauer_h,
          itemStyle: {
            color: r.fahren === '·' ? t.axis : fahrenColor(c, r.fahren), borderRadius: [0, 4, 4, 0],
            opacity: !sel || sel === r.worker_activity_sk ? 1 : 0.35,
          },
        })),
        label: { show: true, position: 'right', color: t.ink2, fontFamily: 'Bahnschrift, sans-serif', formatter: (p: { value: number }) => num(p.value) + ' h' },
      }],
    };
  });

  protected click(e: { dataIndex?: number }): void {
    const r = [...this.bars()].reverse()[e?.dataIndex ?? -1];
    if (!r || !r.worker_activity_sk) return;
    this.store.taet.set(this.store.taet() === r.worker_activity_sk ? null : r.worker_activity_sk);
    this.store.tour.set(null);
  }
}
