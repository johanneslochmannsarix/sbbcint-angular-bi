import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, dateLong, hours, localMs, num, timeLocal } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { PseudonymChip } from '../../../shared/pseudonym-chip';
import { ac9Colors, gaColor, zeitartColor } from '../data/palette';
import { Ac9Store, monthLabel } from '../data/store';
import { ElementRow, katOf } from '../data/types';
import { RuleNote } from './rule-note';

/** Gantt lanes, top to bottom: the plan window (context), the tour's IST span, then the elements by Zeitart. */
const LANES = ['Plan (Kontext)', 'Tour IST', 'Einsatz', 'AZU', 'Fahrten', 'Pause'] as const;
const LANE_OF: Record<string, number> = { Arbeit: 2, AZU: 3, Fahrt: 4, Pause: 5 };

/**
 * View 7b - one tour as a Gantt of its elements (Schichtbestandteile): Einsatz, AZU and Fahrten are billed, Pause
 * is not. Above them the tour's IST span (Beginn bis Ende = brutto) and its plan window as an outline (context,
 * never billed). The header states netto as the model has it (ist_dauer_ohne_pause_h), with the identity
 * brutto − Pause beside it. The person on the tour (one per tour) appears as a pseudonym; a click shows that
 * person's hours.
 */
@Component({
  selector: 'ac9-tour-drill',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, RuleNote, PseudonymChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .td-facts { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); margin: 0 0 8px; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
    .td-facts div { padding: 6px 10px 6px 0; min-width: 0; }
    .td-facts dt { font-size: 11.5px; color: var(--muted); }
    .td-facts dd { margin: 0; font: 600 16px/1.3 var(--ac9-num); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .td-facts dd small { font: 400 12px var(--font-ui); color: var(--muted); }
    .td-who { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--ink-2); margin: 2px 0 6px; }
    @media (max-width: 900px) { .td-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  `],
  template: `
    <app-card heading="Woraus besteht diese Tour, und was davon wird abgerechnet?" [q]="[store.tourKopf, store.elemente]" sub="Tour: Tourelemente nach Zeitart">
      @if (kopf(); as k) {
        <p class="ac9-answer">{{ answer() }}</p>
        <dl class="td-facts">
          <div><dt>Tour</dt><dd [title]="k.tourbezeichnung ?? ''">{{ k.tourbezeichnung ?? '–' }}</dd></div>
          <div><dt>Auftrag</dt><dd><button type="button" class="linkish" (click)="openOrder()" [title]="'Auftrag öffnen'">{{ k.dor_name ?? '–' }}</button></dd></div>
          <div><dt>Geschäftsart, Kategorie</dt><dd>{{ k.geschaeftsart }} <small>{{ k.kategorie_auftrag ? kat(k.kategorie_auftrag) : '' }}</small></dd></div>
          <div><dt>IST brutto</dt><dd>{{ hours(k.ist_dauer_h, 2) }}</dd></div>
          <div><dt>− Pause</dt><dd>{{ hours(k.pause_h, 2) }}</dd></div>
          <div><dt>= abrechenbar</dt><dd>{{ hours(k.netto_h, 2) }} <small>davon AZU {{ hours(k.azu_h, 1) }}, Fahrten {{ hours(k.fahrt_h, 1) }}</small></dd></div>
        </dl>
        <div class="td-who">
          @for (p of persons(); track p) {
            <span>Eingesetzt:</span>
            <app-pseudonym [person]="{ key: $any(p), label: p, mode: 'masked' }" [clickable]="true" (pick)="store.openPerson(p)" />
            <button type="button" class="linkish" (click)="store.openPerson(p)">Stunden dieser Person ›</button>
          }
          @if (unreported() > 0) { <span>{{ num(unreported()) }} Tourelement(e) ohne Rückmeldung</span> }
        </div>
      }
      <div echarts class="chart" [style.height.px]="300" [options]="options() ?? {}" [theme]="theme.echartsTheme()"
           aria-label="Gantt der Tourelemente nach Zeitart, darüber IST-Spanne der Tour und Planfenster als Kontext"></div>
      <ac9-rule [keys]="['netto', 'ist', 'schwelle']" />
    </app-card>
  `,
})
export class TourDrill {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);
  protected readonly hours = hours;
  protected readonly num = num;
  protected readonly kat = (k: string) => katOf(k).label;
  protected readonly kopf = computed(() => this.store.tourKopf.rows()[0] ?? null);
  protected readonly persons = computed(() => [...new Set(this.store.elemente.rows().map((r) => r.person_sk).filter((p): p is string => !!p))]);
  protected readonly unreported = computed(() => this.store.elemente.rows().filter((r) => !r.ist_vollstaendig).length);

  protected readonly answer = computed(() => {
    const k = this.kopf();
    if (!k) return '';
    if (!k.ist_vollstaendig) return `Die Tour ist ${k.tour_abgeschlossen ? 'abgeschlossen, aber nicht zurückgemeldet' : 'noch nicht gefahren'}: es gibt nichts abzurechnen. Plan ${monthLabel(k.plan_monat, true)}.`;
    const over = (k.ist_dauer_h ?? 0) > 14 ? 'über 14 h' : (k.ist_dauer_h ?? 0) > 12 ? 'über 12 h' : (k.ist_dauer_h ?? 0) > 10 ? 'über 10 h (Schwelle ab 2027)' : null;
    const ms = localMs(k.ist_start);
    return `${ms ? dateLong(ms) : ''}: ${num(this.store.elemente.rows().length)} Tourelemente, ${hours(k.netto_h, 2)} abrechenbar` +
      (over ? `; die Schicht liegt ${over}` : '') + '.';
  });

  protected openOrder(): void {
    const tok = this.store.tokenOf(this.kopf()?.dor_name);
    if (tok) this.store.openAuftrag(tok);
  }

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const k = this.kopf();
    const els = this.store.elemente.rows();
    if (!k) return null;
    const t = this.theme.tokens();
    const c = ac9Colors(this.theme.mode());
    type Bar = [number, number, number, string, number | null, string, string];
    const bars: Bar[] = [];
    const ps = localMs(k.plan_start);
    const pe = localMs(k.plan_ende);
    if (ps != null && pe != null) bars.push([0, ps, pe, 'Plan (Kontext)', k.plan_dauer_h, 'plan', '']);
    const is = localMs(k.ist_start);
    const ie = localMs(k.ist_ende);
    if (is != null && ie != null) bars.push([1, is, ie, 'Tour IST brutto', k.ist_dauer_h, 'tour', '']);
    for (const e of els as ElementRow[]) {
      const s = localMs(e.ist_start);
      const en = localMs(e.ist_ende);
      if (s == null || en == null || !e.zeitart) continue;
      bars.push([LANE_OF[e.zeitart] ?? 2, s, en, e.zeitart, e.ist_dauer_h, 'el', e.taetigkeit ?? '']);
    }
    if (!bars.length) return null;
    const lo = Math.min(...bars.map((b) => b[1]));
    const hi = Math.max(...bars.map((b) => b[2]));
    const pad = Math.max(15 * 60_000, (hi - lo) * 0.04);
    const ga = gaColor(c, k.geschaeftsart);
    return {
      animationDuration: 300,
      aria: ariaDecal(),
      grid: { left: 8, right: 16, top: 8, bottom: 8, outerBounds: { left: 8, right: 16, top: 8, bottom: 8 } },
      xAxis: { type: 'time', min: lo - pad, max: hi + pad, splitLine: { show: true, lineStyle: { color: t.grid } },
        axisLabel: { color: t.muted, formatter: (v: number) => timeLocal(v) } },
      yAxis: { type: 'category', data: [...LANES], inverse: true, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: t.ink2 } },
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: { value: Bar }) => {
          const [, s, e, z, h, , taet] = p.value;
          const col = p.value[5] === 'plan' ? null : p.value[5] === 'tour' ? ga : zeitartColor(c, z);
          return ttHead(taet ? `${z}: ${taet}` : z) + ttRow(col, `${timeLocal(s)} – ${timeLocal(e)}`, hours(h, 2)) +
            (z === 'Pause' ? '<div>nicht abgerechnet</div>' : p.value[5] === 'plan' ? '<div>Plan: nur Kontext</div>' : '');
        },
      },
      series: [{
        id: 'td-gantt', type: 'custom', encode: { x: [1, 2], y: 0 }, data: bars,
        renderItem: (_p: unknown, api: { value: (i: number) => number | string; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const lane = api.value(0) as number;
          const a = api.coord([api.value(1) as number, lane]);
          const b = api.coord([api.value(2) as number, lane]);
          const hgt = api.size([0, 1])[1] * (lane < 2 ? 0.42 : 0.6);
          const kind = api.value(5) as string;
          const z = api.value(3) as string;
          const rect = { x: a[0], y: a[1] - hgt / 2, width: Math.max(2, b[0] - a[0] - 1), height: hgt, r: 3 };
          const style = kind === 'plan' ? { fill: 'transparent', stroke: c.plan, lineWidth: 1.5, lineDash: [4, 3] }
            : kind === 'tour' ? { fill: ga, opacity: 0.9 }
            : { fill: zeitartColor(c, z), opacity: 1 };
          return { type: 'rect', shape: rect, style };
        },
      }],
    };
  });

  protected readonly blank = BLANK;
}
