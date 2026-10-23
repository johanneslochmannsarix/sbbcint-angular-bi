import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { personOf } from '../../../core/api';
import { dateLong, dayMs, localMs, minutes, num, pct, timeLocal } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { PseudonymChip } from '../../../shared/pseudonym-chip';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac13Colors } from '../data/palette';
import { Ac13Store } from '../data/store';
import { StandortTagRow, TourListRow } from '../data/types';

/**
 * View 4 - Standort × Tag: where and on which day are the tours, and where do they stay unstaffed? Tours by
 * Tour-Standort; colour = tours or the open share, in six quantile steps of the shown cells (layout only), single
 * hue. The open share splits into sold DL tours (v1-dl_dienstleister_schichttyp, staffed outside CargoControl) and
 * the rest, in the tooltip. A cell or day column opens the day drill: that day's tours (masked tour numbers,
 * pseudonyms; unstaffed tours carry none) - a tour opens the tour drill.
 */
@Component({
  selector: 'ac13-heatmap',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, PseudonymChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="An welchem Tag trägt welcher Standort die Touren, und wo bleiben sie offen?" [q]="store.standortTage"
              emptyNote="Für diese Auswahl gibt es keine Tour im Monat.">
      <div card-tools class="ac13-tools">
        <div class="seg seg-sm" role="group" aria-label="Messgrösse">
          <button type="button" [attr.aria-pressed]="store.heatMeasure() === 'touren'" (click)="store.heatMeasure.set('touren')">Touren</button>
          <button type="button" [attr.aria-pressed]="store.heatMeasure() === 'offen'" (click)="store.heatMeasure.set('offen')">Anteil offen</button>
        </div>
      </div>
      <p class="ac13-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"
           aria-label="Raster Tour-Standort mal Tag; Zelle anklicken öffnet die Touren des Tages"></div>
      @if (store.day(); as day) {
        <div class="ac13-day" role="region" aria-label="Touren des Tages">
          <div class="ac13-side-head">
            <span>{{ dayLabel(day) }}{{ store.standortName() ? ', ' + store.standortName() : '' }}: {{ n(store.tagTouren.rows().length) }} Touren,
              {{ n(openOf(store.tagTouren.rows())) }} offen</span>
            <button type="button" class="linkish" (click)="store.pickDay(null)">schliessen</button>
          </div>
          <div class="ac13-list">
            <table class="ac13-tbl">
              <thead><tr><th>Tour-Standort</th><th>Tour</th><th>Person</th><th>Personaltyp</th><th>Plan</th>
                <th class="num">Arbeitszeit v1</th><th>Merkmale</th></tr></thead>
              <tbody>
                @for (r of store.tagTouren.rows(); track r.tour) {
                  <tr tabindex="0" (click)="store.openTour(r.tour)" (keydown.enter)="store.openTour(r.tour)" [class.is-sel]="r.tour === store.tour()">
                    <td>{{ r.tour_standort }}</td><td>{{ r.tourennummer ?? '–' }}</td>
                    <td>@if (who(r); as p) { <app-pseudonym [person]="p" /> } @else { <span class="ac13-muted">offen</span> }</td>
                    <td>{{ r.personaltyp }}</td><td>{{ tt(r.plan_beginn) }}–{{ tt(r.plan_ende) }}</td>
                    <td class="num">{{ m(r.arbeitszeit_min) }}</td><td>{{ tags(r) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="ac13-empty">{{ store.tagTouren.loading() ? 'Lädt …' : 'Keine Tour an diesem Tag.' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
      <p class="ac13-note">Offen = keine Person eingeteilt. Verkaufte Touren (Schichttyp «… DL Dienstleister») sind fast immer offen: der Dienstleister
        besetzt sie ausserhalb von CargoControl. BI ist Auswertung, kein Dispositionswerkzeug (Aktualisierung etwa alle 3 h).</p>
    </app-card>
  `,
})
export class HeatmapView {
  protected readonly store = inject(Ac13Store);
  protected readonly theme = inject(ThemeService);
  protected readonly n = (v: number | null) => num(v);
  protected readonly m = (v: number | null) => minutes(v);
  protected readonly tt = (v: string | null) => (v ? timeLocal(localMs(v)!) : '–');
  protected readonly dayLabel = (d: string) => dateLong(dayMs(d)!);
  protected readonly openOf = (rows: TourListRow[]) => rows.filter((r) => r.offen).length;
  protected who(r: TourListRow) {
    return personOf(r as unknown as Record<string, unknown>, 'person', 'kennung', this.store.mode());
  }
  protected tags(r: TourListRow): string {
    return [r.verkauft ? 'verkauft' : '', r.schulung ? 'Schulung' : '', r.rolle ? `Übernachtung (${r.rolle})` : ''].filter(Boolean).join(', ');
  }

  private readonly layout = computed(() => {
    const rows = this.store.standortTage.rows().filter((r) => r.touren > 0);
    const days = [...new Set(this.store.standortTage.rows().map((r) => r.datum.slice(0, 10)))].sort();
    const tot = new Map<string, number>();
    for (const r of rows) tot.set(r.standort, (tot.get(r.standort) ?? 0) + r.touren);
    const names = [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    return { rows, days, names, tot };
  });
  protected readonly height = computed(() => Math.max(220, this.layout().names.length * 24 + 64));

  protected readonly answer = computed(() => {
    const { rows, names, tot } = this.layout();
    if (!rows.length) return '';
    const all = rows.reduce((s, r) => s + r.touren, 0);
    const off = rows.reduce((s, r) => s + r.offen, 0);
    const sold = rows.reduce((s, r) => s + r.offen - r.offen_nicht_verkauft, 0);
    const busiest = rows.reduce((a, r) => (r.touren > a.touren ? r : a), rows[0]);
    return `${num(all)} Touren, ${pct(all ? off / all : null, 0)} offen, davon ${num(sold)} verkauft (DL-Schichttypen). `
      + `${names[0]} trägt ${pct(all ? tot.get(names[0])! / all : null, 0)}; dichtester Tag ${busiest.standort}, ${dateLong(dayMs(busiest.datum)!)} (${num(busiest.touren)}).`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const { rows, days, names } = this.layout();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac13Colors(this.theme.mode());
    const share = this.store.heatMeasure() === 'offen';
    const val = (r: StandortTagRow) => (share ? (r.touren ? r.offen / r.touren : 0) : r.touren);
    const yNames = [...names].reverse();
    const yIdx = new Map(yNames.map((n, i) => [n, i]));
    const xIdx = new Map(days.map((d, i) => [d, i]));
    const vals = rows.map(val).filter((v) => v > 0).sort((a, b) => a - b);
    const qs = [1, 2, 3, 4, 5].map((i) => vals[Math.min(vals.length - 1, Math.floor((i / 6) * vals.length))] ?? 0);
    const ramp = c.seq.slice(1);
    const pieces = [0, ...qs].map((lo, i, a) => ({ gt: i === 0 ? -1 : lo, lte: i < a.length - 1 ? a[i + 1] : undefined, color: ramp[i] }));
    const selD = this.store.day();
    const selS = this.store.standortName();
    const byKey = new Map(rows.map((r) => [`${r.standort}|${r.datum.slice(0, 10)}`, r]));
    return {
      aria: ariaDecal(),
      animation: false,
      tooltip: {
        confine: true,
        formatter: (p: { data?: { key?: string } }) => {
          const r = p.data?.key ? byKey.get(p.data.key) : undefined;
          if (!r) return '';
          return ttHead(`${r.standort} · ${dateLong(dayMs(r.datum)!)}`) + ttRow(null, 'Touren', num(r.touren)) + ttRow(c.tour, 'besetzt', num(r.besetzt))
            + ttRow(c.offen, 'offen', `${num(r.offen)} (${pct(r.touren ? r.offen / r.touren : null, 0)})`)
            + ttRow(c.verkauft, 'davon verkauft (DL)', num(r.offen - r.offen_nicht_verkauft));
        },
      },
      grid: { left: 8, right: 12, top: 28, bottom: 8, outerBounds: { left: 8, right: 12, top: 28, bottom: 8 } },
      xAxis: {
        type: 'category', position: 'top', data: days.map((d) => String(Number(d.slice(8, 10)))), triggerEvent: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { interval: 0, fontFamily: FONT_NUM, fontSize: 10.5, color: t.ink2, cursor: 'pointer',
          formatter: (v: string, i: number) => (days[i] === selD ? `{s|${v}}` : v), rich: { s: { color: t.ink, fontWeight: 700, fontFamily: FONT_NUM } } },
      },
      yAxis: { type: 'category', data: yNames, axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: t.ink2, fontSize: 11.5, formatter: (v: string) => (v === selS ? `{s|${v.replace(/^CD - /, '')}}` : v.replace(/^CD - /, '')),
          rich: { s: { color: t.ink, fontWeight: 700 } } } },
      visualMap: { type: 'piecewise', show: false, dimension: 2, pieces, outOfRange: { color: t.grid } },
      series: [{
        type: 'heatmap', cursor: 'pointer',
        data: rows.filter((r) => yIdx.has(r.standort) && xIdx.has(r.datum.slice(0, 10))).map((r) => {
          const d = r.datum.slice(0, 10);
          return {
            key: `${r.standort}|${d}`, value: [xIdx.get(d)!, yIdx.get(r.standort)!, val(r)],
            itemStyle: { borderColor: d === selD ? t.ink : t.surface, borderWidth: d === selD ? 1.2 : 2, opacity: selD == null || d === selD ? 1 : 0.55 },
          };
        }),
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } },
      }],
    };
  });

  protected click(e: { componentType?: string; dataIndex?: number; value?: string; data?: { key?: string } }): void {
    const days = this.layout().days;
    let d: string | undefined;
    if (e?.componentType === 'xAxis' && e.value != null) d = days.find((x) => String(Number(x.slice(8, 10))) === e.value);
    else d = e?.data?.key?.split('|')[1];
    if (!d) return;
    this.store.pickDay(this.store.day() === d ? null : d);
  }
}
