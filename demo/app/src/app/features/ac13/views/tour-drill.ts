import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { personOf } from '../../../core/api';
import { dateLong, dayMs, localMs, minutes, num, timeLocal } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { PseudonymChip } from '../../../shared/pseudonym-chip';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac13Colors } from '../data/palette';
import { Ac13Store } from '../data/store';

const tl = (v: string | null) => (v ? timeLocal(localMs(v)!) : '–');

/**
 * View 6 - one tour: how does Arbeitszeit v1 come out of the plan? A waterfall on one minutes axis: Plandauer,
 * minus each deducted part the rule names (Pause, Arbeitszeitunterbrechung, unbezahlte Unterbrechung,
 * Dienstfahrt), equals Arbeitszeit v1 - every step is a model column, nothing is recomputed except the bar
 * positions; angerechnete Zeit stands next to it as its own bar (a different source, never part of the sum). The
 * model has no element table, so there is no element Gantt (README Q2). Opened from any tour list or point.
 */
@Component({
  selector: 'ac13-tour-drill',
  styleUrl: './tour-drill.css',
  encapsulation: ViewEncapsulation.None,
  imports: [NgxEchartsDirective, ChartResize, ChartCard, PseudonymChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wie entsteht die Arbeitszeit v1 dieser Tour?" [q]="store.tourQ"
              idleText="Eine Tour in einer Liste, im Punktdiagramm oder in einem Übernachtungspaar anklicken." emptyNote="Die Tour ist im Modell nicht mehr vorhanden.">
      <div card-tools><button type="button" class="linkish" [disabled]="!store.tour()" (click)="store.openTour(null)">schliessen</button></div>
      @if (row(); as r) {
        <div class="ac13-facts">
          <div><span>Tour</span><b>{{ r.tourennummer ?? '–' }}</b></div>
          <div><span>Datum</span><b>{{ day(r.datum) }}, {{ tl(r.plan_beginn) }}–{{ tl(r.plan_ende) }}</b></div>
          <div><span>Person</span><b>@if (who(); as p) { <app-pseudonym [person]="p" /> } @else { offen }</b></div>
          <div><span>Tour-Standort</span><b>{{ r.tour_standort }} ({{ r.tour_firma }})</b></div>
          <div><span>Personaltyp</span><b>{{ r.personaltyp }}</b></div>
          <div><span>Start → Ziel</span><b>{{ r.start ?? '–' }} → {{ r.ziel ?? '–' }}</b></div>
          <div><span>Merkmale</span><b>{{ tags() }}</b></div>
          <div><span>Kommunikation</span><b>{{ r.kommunikationsstand ?? '–' }}</b></div>
        </div>
      }
      <div echarts class="chart" [style.height.px]="250" [options]="options()!" [theme]="theme.echartsTheme()"
           aria-label="Wasserfall Plandauer minus Abzüge gleich Arbeitszeit v1, daneben angerechnete Zeit"></div>
      <p class="ac13-note">{{ store.stand.rows()[0]?.hinweis_arbeitszeit ?? '' }} Elementzeiten (Gantt) zeigt dieses Modell nicht: es enthält je Tour nur die Summen der Abzüge.</p>
    </app-card>
  `,
})
export class TourDrillView {
  protected readonly store = inject(Ac13Store);
  protected readonly theme = inject(ThemeService);
  protected readonly tl = tl;
  protected readonly day = (d: string) => dateLong(dayMs(d)!);
  protected readonly row = computed(() => this.store.tourQ.rows()[0] ?? null);
  protected readonly who = computed(() => {
    const r = this.row();
    return r ? personOf(r as unknown as Record<string, unknown>, 'person', 'kennung', this.store.mode()) : null;
  });
  protected readonly tags = computed(() => {
    const r = this.row();
    if (!r) return '';
    return [r.offen ? 'offen' : 'besetzt', r.verkauft ? `verkauft (DL ${r.dienstleister ?? ''})` : '',
      r.schulung ? `Schulung (${num(r.schulung_elemente)} Elemente)` : '', r.rolle ? `Übernachtung, ${r.rolle}` : '',
      r.ge14 ? '≥ 14 h' : r.ge12 ? '≥ 12 h' : ''].filter(Boolean).join(', ');
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const r = this.row();
    if (!r) return null;
    const t = this.theme.tokens();
    const c = ac13Colors(this.theme.mode());
    const plan = r.plandauer_min ?? 0;
    const parts: [string, number][] = [['Pause', r.pause_min ?? 0], ['Arbeitszeitunterbrechung', r.azu_min ?? 0],
      ['unbezahlte Unterbrechung', r.unbezahlt_min ?? 0], ['Dienstfahrt', r.dienstfahrt_min ?? 0]];
    const cats = ['Plandauer', ...parts.map(([n]) => `− ${n}`), '= Arbeitszeit v1', 'angerechnete Zeit'];
    const base: (number | string)[] = [0];
    const step: (number | string)[] = [plan];
    let run = plan;
    for (const [, v] of parts) {
      run -= v;
      base.push(Math.max(0, Math.min(run, run + v)));
      step.push(Math.abs(v));
    }
    base.push(0, 0);
    const angerLeer = r.angerechnet_min == null;
    step.push(r.arbeitszeit_min ?? 0, r.angerechnet_min ?? 0);
    const colors = [c.az, ...parts.map(() => t.neutral), c.az, c.anger];
    return {
      aria: ariaDecal(),
      animationDuration: 300,
      grid: { left: 8, right: 18, top: 10, bottom: 8, outerBounds: { left: 8, right: 18, top: 10, bottom: 8 } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          return ttHead(cats[i]) + ttRow(colors[i], 'Minuten', i === cats.length - 1 && angerLeer ? 'nicht gefüllt' : minutes(step[i] as number));
        },
      },
      xAxis: { type: 'value', min: 0, axisLabel: { fontFamily: FONT_NUM, formatter: (v: number) => `${num(v / 60, 0)} h` } },
      yAxis: { type: 'category', data: cats, inverse: true, axisTick: { show: false }, axisLabel: { color: t.ink2, fontSize: 11.5 } },
      series: [
        { type: 'bar', stack: 'w', silent: true, itemStyle: { color: 'transparent' }, data: base, tooltip: { show: false } },
        {
          type: 'bar', stack: 'w', barMaxWidth: 18,
          data: step.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [0, 3, 3, 0] } })),
          label: { show: true, position: 'right', color: t.ink2, fontFamily: FONT_NUM, fontSize: 11,
            formatter: (p: { dataIndex: number; value: number | string }) => (p.dataIndex === cats.length - 1 && angerLeer ? 'nicht gefüllt' : minutes(Number(p.value))) },
        },
      ],
    };
  });
}
