import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { UiTable } from '../../../shared/ui';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { PseudonymChip } from '../../../shared/pseudonym-chip';
import { ac9Colors, gaColor } from '../data/palette';
import { Ac9Store, monthLabel } from '../data/store';
import { RuleNote } from './rule-note';

/**
 * View 7c - one person (pseudonym only; reached from the tour Gantt or from AC-7): billable hours per month and
 * order, the RDL's section B «Stunden je Mitarbeiter/in» without name or personnel number. The month here is the
 * element's IST month (the model's person-level month); the RDL groups by the tour's month, so a tour across a
 * month end can sit one month apart. Measured: every AC-9 person with IST is in AC-7's Verleihliste under the same
 * key (168 / 168 PROD), so the person links there.
 */
@Component({
  selector: 'ac9-person-drill',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, RuleNote, PseudonymChip, RouterLink, UiTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wie viele Stunden hat diese Person abgerechnet?" [q]="store.personQ" sub="Person: Stunden je Monat und Auftrag">
      <div card-tools>
        <a class="linkish" [routerLink]="['/ac7']" [queryParams]="{ env: store.env(), d: store.person() }" title="Dieselbe Person in der AÜ-Verleihliste (AC-7)">In der AÜ-Verleihliste ›</a>
      </div>
      <p class="ac9-answer">
        @if (store.person(); as p) { <app-pseudonym [person]="{ key: $any(p), label: p, mode: 'masked' }" /> }
        {{ answer() }}
      </p>
      <div echarts class="chart" [style.height.px]="240" [options]="options() ?? {}" [theme]="theme.echartsTheme()"
           aria-label="Abrechenbare Stunden dieser Person je Monat, nach Auftrag gestapelt"></div>
      <div class="table-wrap">
        <table class="tbl tbl-click" uiTable>
          <thead><tr><th>Monat</th><th>Auftrag</th><th>GA</th><th class="r">Touren</th><th class="r">Tourelemente</th><th class="r">brutto</th><th class="r">abrechenbar</th></tr></thead>
          <tbody>
            @for (r of rowsDesc(); track r.year_month + (r.dor_name ?? '')) {
              <tr (click)="open(r.dor_name)" tabindex="0" (keydown.enter)="open(r.dor_name)">
                <td>{{ monthLabel(r.year_month) }}</td><td>{{ r.dor_name ?? '–' }}</td><td>{{ r.geschaeftsart }}</td>
                <td class="r">{{ num(r.touren) }}</td><td class="r">{{ num(r.elemente) }}</td>
                <td class="r">{{ num(r.brutto_h, 1) }}</td><td class="r">{{ num(r.netto_h, 1) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <ac9-rule [keys]="['netto', 'mindest']" />
    </app-card>
  `,
})
export class PersonDrill {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);
  protected readonly num = num;
  protected readonly monthLabel = monthLabel;
  protected readonly rowsDesc = computed(() => [...this.store.personQ.rows()].sort((a, b) => b.year_month.localeCompare(a.year_month) || b.netto_h - a.netto_h));

  protected readonly answer = computed(() => {
    const rows = this.store.personQ.rows();
    if (!rows.length) return '';
    const months = [...new Set(rows.map((r) => r.year_month))].sort();
    const orders = new Set(rows.map((r) => r.dor_name)).size;
    const last = [...rows].filter((r) => r.year_month === months.at(-1)).sort((a, b) => b.netto_h - a.netto_h)[0];
    return `Zurückgemeldet in ${months.length} Monaten (${monthLabel(months[0])} – ${monthLabel(months.at(-1))}) auf ${orders} ${orders === 1 ? 'Auftrag' : 'Aufträgen'}; ` +
      `zuletzt ${hours(last.netto_h)} abrechenbar auf ${last.dor_name ?? '–'}.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.personQ.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac9Colors(this.theme.mode());
    const months = [...new Set(rows.map((r) => r.year_month))].sort();
    const orders = [...new Set(rows.map((r) => r.dor_name ?? '–'))];
    const ga = (o: string) => rows.find((r) => (r.dor_name ?? '–') === o)?.geschaeftsart ?? null;
    return {
      aria: ariaDecal(),
      // no legend: a segment is one order (named in the tooltip and the table), its colour is the Geschäftsart
      grid: { left: 8, right: 8, top: 12, bottom: 6, outerBounds: { left: 8, right: 8, top: 12, bottom: 6 } },
      xAxis: { type: 'category', data: months, axisLabel: { color: t.muted, formatter: (m: string) => monthLabel(m) } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: (ps: { name: string }[]) => {
          const m = ps[0]?.name;
          return ttHead(monthLabel(m, true)) + rows.filter((r) => r.year_month === m)
            .map((r) => ttRow(gaColor(c, r.geschaeftsart), r.dor_name ?? '–', hours(r.netto_h))).join('');
        },
      },
      // one segment per order (a returned value each, stacked = layout), coloured by its Geschäftsart; the 2 px
      // surface border keeps orders of the same Geschäftsart apart
      series: orders.map((o) => ({
        id: `pd-${o}`, name: o, type: 'bar', stack: 'p', barMaxWidth: 22,
        itemStyle: { color: gaColor(c, ga(o)), borderColor: t.surface, borderWidth: 1 },
        data: months.map((m) => rows.find((r) => r.year_month === m && (r.dor_name ?? '–') === o)?.netto_h ?? null),
      })),
    };
  });

  protected open(label: string | null): void {
    const tok = this.store.tokenOf(label);
    if (tok) this.store.openAuftrag(tok);
  }
}
