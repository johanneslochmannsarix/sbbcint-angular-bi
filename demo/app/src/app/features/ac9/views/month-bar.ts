import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ChartGroup } from '../../../shared/connect';
import { ac9Colors, hatch } from '../data/palette';
import { Ac9Store, monthLabel } from '../data/store';
import { GA_LABEL } from '../data/types';

/**
 * View 0 - the month bar and the KPI band. The bar is the month picker for the whole page: billable hours (ohne
 * Pause) per Abrechnungsmonat, stacked AÜ / DL; a click picks a month, shift-click extends the range, a second
 * click on the picked month shows all months. The running month is hatched (still filling). Under it the
 * month's statement in five figures, each a model measure; AÜ / DL and International filter the page.
 */
@Component({
  selector: 'ac9-month-bar',
  imports: [NgxEchartsDirective, ChartResize, ChartGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ac9-monthbar', role: 'region', 'aria-label': 'Abrechnungsmonat und Kennzahlen' },
  styles: [`
    :host { display: block; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-card); }
    .mb-top { display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 10px 14px 0; }
    .mb-q { margin: 0; font: 400 17px/1.3 var(--ac9-serif); color: var(--ink); }
    .mb-chart { height: 92px; margin: 0 6px; cursor: pointer; }
    .mb-hint { font-size: 12px; color: var(--muted); }
    .band { display: grid; grid-template-columns: 1.5fr 1fr 1.25fr 1fr 1.15fr; border-top: 1px solid var(--rule); }
    .fig { all: unset; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px; padding: 12px 16px 14px; border-right: 1px solid var(--rule); min-width: 0; }
    .fig:last-child { border-right: 0; }
    button.fig { cursor: pointer; }
    button.fig:hover { background: var(--mark); }
    button.fig:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .fig[aria-pressed="true"] { background: var(--accent-wash); }
    .fig-l { font-size: 12.5px; color: var(--ink-2); }
    .fig-v { font: 600 26px/1.1 var(--ac9-num); color: var(--ink); white-space: nowrap; }
    .fig-hero .fig-v { font-size: 40px; letter-spacing: -0.01em; }
    .fig-n { font-size: 12px; color: var(--muted); line-height: 1.35; }
    .split { display: flex; height: 10px; border-radius: 2px; overflow: hidden; gap: 2px; margin: 6px 0 2px; }
    .split-b { all: unset; cursor: pointer; height: 100%; min-width: 4px; }
    .split-b[aria-pressed="false"] { opacity: .35; }
    .split-l { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: var(--ink); }
    .split-l span { white-space: nowrap; }
    .key { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; }
    @media (max-width: 1200px) { .band { grid-template-columns: repeat(3, minmax(0, 1fr)); } .fig { border-bottom: 1px solid var(--rule); } }
    @media (max-width: 640px) { .band { grid-template-columns: minmax(0, 1fr); } .fig { border-right: 0; } .fig-hero .fig-v { font-size: 32px; } }
  `],
  template: `
    <div class="mb-top">
      <p class="mb-q">{{ question() }}</p>
      <span class="mb-hint">Monat anklicken wählt ihn, mit Umschalt einen Bereich; noch einmal: alle Monate.</span>
    </div>
    <div echarts class="mb-chart" [options]="options() ?? {}" [theme]="theme.echartsTheme()" chartGroup="ac9-monate"
         (chartClick)="click($any($event))" aria-label="Abrechenbare Stunden je Abrechnungsmonat, AÜ und DL gestapelt; Monat anklicken wählt ihn"></div>
    <div class="band">
      <div class="fig fig-hero">
        <span class="fig-l">Abrechenbar, ohne Pause<sup class="ac9-fn">2</sup></span>
        <span class="fig-v">{{ t() ? hours(t()!.netto_h) : '…' }}</span>
        <span class="fig-n">{{ t() ? 'IST brutto ' + hours(t()!.brutto_h) + ' − Pause ' + hours(t()!.pause_h) : '' }}</span>
      </div>
      <div class="fig">
        <span class="fig-l">Touren mit IST<sup class="ac9-fn">8</sup></span>
        <span class="fig-v">{{ t() ? num(t()!.touren) : '…' }}</span>
        <span class="fig-n">{{ t() ? 'Ø ' + hours(t()!.avg_h, 2) + ' je Tour, ' + num(t()!.auftraege) + ' Aufträge' : '' }}</span>
      </div>
      <div class="fig">
        <span class="fig-l">Arbeitnehmerüberlassung und Dienstleistung</span>
        <div class="split" role="group" aria-label="Geschäftsart filtern">
          @for (g of split(); track g.code) {
            <button type="button" class="split-b" [style.flex-grow]="g.h" [style.background]="g.color"
                    [attr.aria-pressed]="store.ga() ? store.ga() === g.code : null" [title]="g.long + ': als Filter setzen'"
                    (click)="store.setGa(g.code)"></button>
          }
        </div>
        <div class="split-l">
          @for (g of split(); track g.code) {
            <span><i class="key" [style.background]="g.color"></i>{{ g.label }} {{ hours(g.h) }}</span>
          }
        </div>
      </div>
      <button type="button" class="fig" [attr.aria-pressed]="store.kat() === 'int'" (click)="store.setKat('int')"
              title="Nur internationale Leistungen (Kategorie des Auftrags) zeigen">
        <span class="fig-l">International, Anteil SBB-CD-Touren<sup class="ac9-fn">4</sup></span>
        <span class="fig-v">{{ t() ? pct(t()!.anteil_int, 1) : '…' }}</span>
        <span class="fig-n">{{ t() ? num(t()!.touren_int) + ' von ' + num(t()!.touren_sbbcd) + ' SBB-CD-Touren; SBB CD rechnet je Tour ab' : '' }}</span>
      </button>
      <a class="fig" href="#ac9-quote" (click)="scrollQuote($event)">
        <span class="fig-l">Rückmeldequote, als Planmonat<sup class="ac9-fn">7</sup></span>
        <span class="fig-v">{{ t() ? pct(t()!.quote, 1) : '…' }}</span>
        <span class="fig-n">{{ t() ? num(t()!.quote_fehlt) + ' von ' + num(t()!.quote_abgeschlossen) + ' abgeschlossenen Touren ohne Rückmeldung' : '' }}</span>
      </a>
    </div>
  `,
})
export class MonthBar {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);
  protected readonly hours = hours;
  protected readonly num = num;
  protected readonly pct = pct;
  protected readonly t = this.store.kpiTotal;
  protected readonly question = computed(() => {
    const v = this.store.von();
    if (!v) return 'Was ist über alle Monate abrechenbar?';
    return v === this.store.bis() ? `Was ist im ${this.store.rangeTextLong()} abrechenbar?` : `Was ist von ${this.store.rangeTextLong()} abrechenbar?`;
  });

  protected readonly split = computed(() => {
    const c = ac9Colors(this.theme.mode());
    const by = new Map(this.store.kpiGa().map((r) => [r.geschaeftsart, r.netto_h]));
    return [
      { code: 'AUE' as const, label: 'AÜ', long: GA_LABEL['AÜ'], h: by.get('AÜ') ?? 0, color: c.aue },
      { code: 'DL' as const, label: 'DL', long: GA_LABEL['DL'], h: by.get('DL') ?? 0, color: c.dl },
    ];
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.monate.rows().filter((r) => !r.ga_total);
    const months = this.store.months();
    if (!months.length) return null;
    const t = this.theme.tokens();
    const c = ac9Colors(this.theme.mode());
    const val = (m: string, ga: string) => rows.find((r) => r.year_month_ist === m && r.geschaeftsart === ga)?.netto_h ?? 0;
    const series = (['AÜ', 'DL'] as const).map((ga, i) => ({
      id: `mb-${ga}`, name: ga, type: 'bar', stack: 'h', barMaxWidth: 22, cursor: 'pointer',
      data: months.map((m) => ({
        value: val(m, ga), name: m,
        itemStyle: {
          color: ga === 'AÜ' ? c.aue : c.dl,
          opacity: this.store.inRange(m) ? 1 : 0.28,
          borderRadius: i === 1 ? [3, 3, 0, 0] : 0,
          decal: this.store.running(m) ? hatch(this.theme.mode()) : undefined,
        },
      })),
    }));
    return {
      animationDuration: 250,
      aria: ariaDecal(),
      grid: { left: 8, right: 8, top: 6, bottom: 18 },
      xAxis: {
        type: 'category', data: months, axisLine: { lineStyle: { color: t.axis } },
        axisLabel: { color: t.muted, fontSize: 10.5, interval: 0, formatter: (v: string) => (v.endsWith('-01') || v === months[0] ? monthLabel(v) : monthLabel(v).slice(0, 3)) },
      },
      yAxis: { type: 'value', show: false, min: 0 },
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: (ps: { name: string }[]) => {
          const m = ps[0]?.name;
          const tot = this.store.monate.rows().find((r) => r.ga_total && r.year_month_ist === m);
          return ttHead(monthLabel(m, true) + (this.store.running(m) ? ' (läuft noch)' : '')) +
            ttRow(c.aue, 'AÜ abrechenbar', hours(val(m, 'AÜ'))) + ttRow(c.dl, 'DL abrechenbar', hours(val(m, 'DL'))) +
            ttRow(null, 'Touren mit IST', tot ? num(tot.touren) : BLANK);
        },
      },
      series,
    };
  });

  protected click(e: { name?: string; event?: { event?: MouseEvent } }): void {
    if (e?.name) this.store.pickMonth(e.name, !!e.event?.event?.shiftKey);
  }

  protected scrollQuote(ev: Event): void {
    ev.preventDefault();
    document.getElementById('ac9-quote')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
