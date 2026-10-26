import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { createGet } from '../../../core/query';
import { BLANK, dateLong, dateOnly, dateTimeLU, dayMs, hours, isoDay, localMs, num } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { UiTable } from '../../../shared/ui';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac9Colors, gaColor } from '../data/palette';
import { Ac9Store, monthLabel } from '../data/store';
import { GA_LABEL, TourRow, katOf } from '../data/types';
import { RuleNote } from './rule-note';

const MAX_ROWS = 250;

interface Ac7Orders { rows: { auftrag_token: string | null }[] }

/**
 * View 7a - one order (the report's drillthrough «Auftrag», opened from the portfolio or a deep link
 * /ac9?auftrag=T-…). The whole page is filtered to it (KPI band, waterfall, trend, quote, distributions); this
 * card adds what only an order has: its tour days as a calendar (billable hours per IST day, all months) and its
 * tours in the selected months - reported ones by Abrechnungsmonat, finished unreported ones by their planned
 * month. A day in the calendar narrows the list; a tour opens it. Where the order is also a stint in AC-7's
 * Verleihliste (measured: AC-7's orders are 100 % in this model), a link opens it there.
 */
@Component({
  selector: 'ac9-auftrag-drill',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, RuleNote, RouterLink, UiTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .od-head { display: flex; flex-wrap: wrap; gap: 6px 28px; align-items: baseline; margin: 0 0 8px; }
    .od-head dl { display: flex; gap: 22px; flex-wrap: wrap; margin: 0; }
    .od-head dt { font-size: 11.5px; color: var(--muted); }
    .od-head dd { margin: 0; font-size: 13.5px; color: var(--ink); }
    .od-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
    .od-cal { width: 100%; }
    .od-filter { display: flex; gap: 10px; align-items: center; font-size: 12.5px; color: var(--ink-2); margin: 4px 0; }
    .st { font-size: 11.5px; padding: 0 6px; border-radius: 3px; border: 1px solid var(--rule-strong); color: var(--ink-2); }
    .st-miss { border-style: dashed; color: var(--muted); }
    .abw { color: var(--ink); font-weight: 600; }
  `],
  template: `
    <app-card heading="Was wurde auf diesem Auftrag geleistet?" [q]="[store.tage, store.touren]" sub="Auftrag: Tourtage und Touren">
      <div card-tools>
        @if (ac7Link(); as t) {
          <a class="linkish" [routerLink]="['/ac7']" [queryParams]="{ env: store.env(), a: t }" title="Derselbe Auftrag als Verleihstation in AC-7">In der AÜ-Verleihliste ›</a>
        }
      </div>
      <div class="od-head">
        <h3 class="ac9-order">{{ store.orderLabel() }}</h3>
        @if (store.order(); as o) {
          <dl>
            <div><dt>Geschäftsart</dt><dd>{{ gaLabel(o.geschaeftsart) }}</dd></div>
            <div><dt>Kategorie (Auftrag)</dt><dd>{{ kat(o.kategorie_auftrag) }}</dd></div>
            <div><dt>Abrechnungsmonate</dt><dd>{{ monthLabel(o.erster_monat) }} – {{ monthLabel(o.letzter_monat) }}</dd></div>
            <div><dt>Touren gesamt / mit IST</dt><dd>{{ num(o.touren) }} / {{ num(o.touren_ist) }}</dd></div>
            <div><dt>abrechenbar gesamt</dt><dd>{{ hours(o.netto_h) }}</dd></div>
          </dl>
        }
      </div>
      <div class="od-grid">
        <div echarts class="chart od-cal" [style.height.px]="calHeight()" [options]="calendar() ?? {}" [theme]="theme.echartsTheme()"
             (chartClick)="pickDay($any($event))" aria-label="Kalender: abrechenbare Stunden je IST-Tag dieses Auftrags; Tag anklicken filtert die Tourliste"></div>
        <div class="od-filter">
          <span>{{ listTitle() }}</span>
          @if (day()) { <button type="button" class="linkish" (click)="day.set(null)">Tag aufheben</button> }
        </div>
        <div class="table-wrap table-tall">
          <table class="tbl tbl-click" uiTable>
            <thead><tr>
              <th>Tour</th><th>IST-Beginn</th><th>IST-Ende</th><th class="r">brutto</th><th class="r">Pause</th><th class="r">abrechenbar</th>
              <th class="r">AZU</th><th class="r">Fahrten</th><th class="r">Plan (Kontext)</th><th>Status</th><th>Kategorie Tournummer</th>
            </tr></thead>
            <tbody>
              @for (r of list(); track r.tour) {
                <tr (click)="store.openTour(r.tour)" [class.is-selected]="store.tour() === r.tour" tabindex="0" (keydown.enter)="store.openTour(r.tour)">
                  <td>{{ r.tourbezeichnung ?? '–' }}</td>
                  <td>{{ r.ist_start ? dt(r.ist_start) : '–' }}</td>
                  <td>{{ r.ist_ende ? dt(r.ist_ende) : '–' }}</td>
                  <td class="r">{{ h(r.ist_dauer_h) }}</td><td class="r">{{ h(r.pause_h) }}</td><td class="r">{{ h(r.netto_h) }}</td>
                  <td class="r">{{ h(r.azu_h) }}</td><td class="r">{{ h(r.fahrt_h) }}</td><td class="r">{{ h(r.plan_dauer_h) }}</td>
                  <td>@if (r.ist_vollstaendig) { <span class="st">zurückgemeldet</span> } @else { <span class="st st-miss">Rückmeldung fehlt ({{ monthLabel(r.plan_monat) }})</span> }</td>
                  <td [class.abw]="mismatch(r)">{{ r.preiskategorie ? katLabel(r.preiskategorie) + (mismatch(r) ? ' ≠ Auftrag' : '') : '–' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (more() > 0) { <p class="chart-note">{{ num(more()) }} weitere Touren; Monat oder Tag eingrenzen.</p> }
      </div>
      <ac9-rule [keys]="['monat', 'kategorie']" />
    </app-card>
  `,
})
export class AuftragDrill {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);
  protected readonly day = signal<string | null>(null);
  protected readonly num = num;
  protected readonly hours = hours;
  protected readonly monthLabel = monthLabel;
  protected readonly h = (v: number | null) => (v == null ? BLANK : num(v, 1));
  protected readonly dt = (v: string) => dateTimeLU(localMs(v)).replace(/ \(.*\)$/, '');
  protected readonly gaLabel = (g: string | null) => (g ? `${g}, ${GA_LABEL[g] ?? ''}` : BLANK);
  protected readonly kat = (k: string | null) => (k ? katOf(k).label : 'keine (nur SBB-CD-Dienstleistung)');
  protected readonly katLabel = (k: string) => katOf(k).label;
  protected readonly mismatch = (r: TourRow) => !!r.kategorie_auftrag && !!r.preiskategorie && r.kategorie_auftrag !== r.preiskategorie;

  /** AC-7's own order list (its route, read-only): link only where the order is a stint there */
  private readonly ac7 = createGet<Ac7Orders>('ac7', () => ({ path: 'auftraege', params: { env: this.store.env() } }));
  protected readonly ac7Link = computed(() => {
    const a = this.store.auftrag();
    return a && (this.ac7.result()?.rows ?? []).some((r) => r.auftrag_token === a) ? a : null;
  });

  private readonly rows = computed(() => {
    const d = this.day();
    const all = this.store.touren.rows();
    return d ? all.filter((r) => (r.ist_start ?? '').slice(0, 10) === d) : all;
  });
  protected readonly list = computed(() => this.rows().slice(0, MAX_ROWS));
  protected readonly more = computed(() => Math.max(0, this.rows().length - MAX_ROWS));
  protected readonly listTitle = computed(() => {
    const all = this.store.touren.rows();
    const rep = all.filter((r) => r.ist_vollstaendig).length;
    const d = this.day();
    if (d) return `${num(this.rows().length)} Touren mit IST-Beginn am ${dateLong(dayMs(d)!)}`;
    return `${num(all.length)} Touren im ${this.store.rangeTextLong()}: ${num(rep)} zurückgemeldet, ${num(all.length - rep)} abgeschlossen ohne Rückmeldung`;
  });

  private readonly years = computed(() => [...new Set(this.store.tage.rows().map((r) => r.datum.slice(0, 4)))].sort());
  protected readonly calHeight = computed(() => Math.max(1, this.years().length) * 150 + 30);

  /** [first day of the first month, last day of the last month] of the order's tour days in year y */
  private span(y: string): [string, string] {
    const ds = this.store.tage.rows().map((r) => r.datum.slice(0, 10)).filter((d) => d.startsWith(y)).sort();
    const a = `${ds[0].slice(0, 7)}-01`;
    const [yy, mm] = ds[ds.length - 1].slice(0, 7).split('-').map(Number);
    const last = new Date(yy, mm, 0).getDate();
    return [a, `${ds[ds.length - 1].slice(0, 7)}-${String(last).padStart(2, '0')}`];
  }

  protected readonly calendar = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.tage.rows();
    const years = this.years();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac9Colors(this.theme.mode());
    const max = Math.max(...rows.map((r) => r.netto_h));
    const color = gaColor(c, this.store.order()?.geschaeftsart);
    return {
      aria: ariaDecal(),
      tooltip: {
        confine: true,
        formatter: (p: { value: [string, number, number, number] }) => ttHead(dateLong(dayMs(p.value[0])!)) +
          ttRow(color, 'abrechenbar', hours(p.value[1])) + ttRow(null, 'Touren mit IST', num(p.value[2])) + ttRow(null, 'davon über 12 h', num(p.value[3])),
      },
      visualMap: {
        show: true, min: 0, max: Math.max(1, Math.ceil(max)), calculable: false, orient: 'horizontal', left: 36, top: 0, itemWidth: 10, itemHeight: 90,
        text: [hours(max, 0), '0 h'], textStyle: { color: t.muted, fontSize: 11 },
        inRange: { color: [t.grid, color] }, dimension: 1,
      },
      // each year from the order's first to its last month only (a one-month order is not a year of empty cells)
      calendar: years.map((y, i) => ({
        top: 40 + i * 150, left: 36, right: 8, cellSize: ['auto', 14], range: this.span(y),
        dayLabel: { firstDay: 1, nameMap: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], color: t.muted, fontSize: 10 },
        monthLabel: { nameMap: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'], color: t.ink2 },
        yearLabel: { show: true, color: t.muted, position: 'left' },
        splitLine: { lineStyle: { color: t.axis, width: 1 } }, itemStyle: { borderColor: t.surface, borderWidth: 2 },
      })),
      series: years.map((y, i) => ({
        id: `cal-${y}`, type: 'heatmap', coordinateSystem: 'calendar', calendarIndex: i, cursor: 'pointer',
        data: rows.filter((r) => r.datum.startsWith(y)).map((r) => [r.datum.slice(0, 10), r.netto_h, r.touren, r.ue12]),
      })),
    };
  });

  protected pickDay(e: { value?: [string] }): void {
    const d = e?.value?.[0];
    if (d) this.day.set(this.day() === d ? null : isoDay(dayMs(d)!));
  }

  protected readonly dateOnly = dateOnly;
}
