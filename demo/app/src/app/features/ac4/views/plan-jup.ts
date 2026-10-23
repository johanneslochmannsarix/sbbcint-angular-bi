import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { dateLong, dayMs, hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { HATCH, HATCH_DARK, ac4Colors } from '../data/palette';
import { Ac4Store, monthLabel } from '../data/store';
import { JupRow } from '../data/types';

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
/** JS getDay (0 = So) -> index in DAYS */
const IDX = (ms: number) => (new Date(ms).getDay() + 6) % 7;

/**
 * View 3 - Plan vs JUP. Left: the disposition's planned hours per calendar day (calendar heatmap over the whole
 * planned window, single-hue ramp; clicking a day picks its month). Right: the weekday profile - the mean
 * planned hours per weekday of the disposition (days of the selected month, or all) next to ONE JUP version's
 * pattern week (fico_planung). Two separate queries: the tables have no relationship (F10), so this compares
 * two profiles, never rows. Versions are never summed; «Schichtbildung 1» (Zedas-JUP 5) is the default, as in
 * the report.
 */
@Component({
  selector: 'ac4-plan-jup',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Folgt die Disposition der Jahresplanung?" [q]="[store.kalender, store.jup]">
      <div card-tools class="ac4-tools">
        <label class="ac4-field">JUP-Version
          <select class="select" [value]="version() ?? ''" (change)="store.jupVersion.set($any($event.target).value || null)">
            @for (v of versions(); track v.name) { <option [value]="v.name">{{ v.name }} ({{ v.touren }} Touren)</option> }
          </select>
        </label>
      </div>
      <p class="ac4-answer">{{ answer() }}</p>
      <div class="ac4-split ac4-split-wide">
        <div echarts class="chart" [style.height.px]="calHeight()" [options]="calendar()!" [theme]="theme.echartsTheme()" (chartClick)="day($any($event))"></div>
        <div echarts class="chart" style="height: 300px" [options]="profile()!" [theme]="theme.echartsTheme()"></div>
      </div>
      <p class="ac4-cover">Die Jahresplanung ist eine Musterwoche ohne Kalenderdatum; sie hat keine Beziehung zur Disposition. Verglichen werden nur zwei Profile: Plandauer je Wochentag. «Ungeplant» (Einsätze ohne Tour, ohne Version) zählt nicht zur Musterwoche.{{ standortNote() }}</p>
    </app-card>
  `,
})
export class PlanJupView {
  protected readonly store = inject(Ac4Store);
  protected readonly theme = inject(ThemeService);

  protected readonly versions = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.store.jup.rows()) if (r.jup_version) m.set(r.jup_version, (m.get(r.jup_version) ?? 0) + (r.touren ?? 0));
    return [...m].sort((a, b) => b[1] - a[1]).map(([name, touren]) => ({ name, touren }));
  });
  protected readonly version = computed(() => {
    const pick = this.store.jupVersion();
    const vs = this.versions();
    if (pick && vs.some((v) => v.name === pick)) return pick;
    return vs.find((v) => v.name === 'Schichtbildung 1')?.name ?? vs[0]?.name ?? null;
  });
  protected readonly standortNote = computed(() => (this.store.standort() ? ' Der Tourstandort ist für die JUP über seinen Namen gefiltert (die Planung hat keinen Schlüssel).' : ''));

  /** JUP hours per weekday of the chosen version (Schichtgeplant rows only) */
  private readonly jupDays = computed(() => {
    const v = this.version();
    const out = DAYS.map(() => ({ dauer: 0, fahren: 0, touren: 0 }));
    for (const r of this.store.jup.rows() as JupRow[]) {
      if (r.jup_version !== v) continue;
      const i = DAYS.indexOf((r.musterwochentag ?? '').slice(0, 2));
      if (i < 0) continue;
      out[i].dauer += r.dauer_h ?? 0;
      out[i].fahren += r.fahren_h ?? 0;
      out[i].touren += r.touren ?? 0;
    }
    return out;
  });
  /** disposition: weekday bucketing of the returned days, mean per occurrence (layout) */
  private readonly dispDays = computed(() => {
    const m = this.store.month();
    const acc = DAYS.map(() => ({ h: 0, n: 0, fahren: 0 }));
    for (const r of this.store.kalender.rows()) {
      if (m && !r.tag.startsWith(m)) continue;
      const ms = dayMs(r.tag);
      if (ms == null) continue;
      const a = acc[IDX(ms)];
      a.h += r.plandauer_h ?? 0;
      a.fahren += r.fahren_h ?? 0;
      a.n += 1;
    }
    return acc.map((a) => ({ h: a.n ? a.h / a.n : null, fahren: a.n ? a.fahren / a.n : null, n: a.n }));
  });

  protected readonly answer = computed(() => {
    const j = this.jupDays();
    const d = this.dispDays();
    const jt = j.reduce((s, x) => s + x.dauer, 0);
    const dt = d.reduce((s, x) => s + (x.h ?? 0), 0);
    if (!jt || !dt) return 'Für diese Auswahl fehlt eine der beiden Seiten.';
    const wkJ = (j[5].dauer + j[6].dauer) / jt;
    const wkD = ((d[5].h ?? 0) + (d[6].h ?? 0)) / dt;
    return `Am Wochenende liegen ${pct(wkD)} der disponierten Stunden einer Woche (${monthLabel(this.store.month())}), in der Musterwoche «${this.version()}» ${pct(wkJ)}.`;
  });

  protected readonly calHeight = computed(() => 230);

  protected readonly calendar = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.kalender.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac4Colors(this.theme.mode());
    const first = rows[0].tag.slice(0, 10);
    const last = rows[rows.length - 1].tag.slice(0, 10);
    const max = Math.max(...rows.map((r) => r.plandauer_h ?? 0));
    const m = this.store.month();
    return {
      aria: ariaDecal(),
      tooltip: {
        confine: true,
        formatter: (p: { data: [string, number, number, number] }) => {
          const [tag, h, touren, fahren] = p.data;
          const inc = this.store.incomplete(tag.slice(0, 7));
          return ttHead(dateLong(dayMs(tag)!)) + ttRow(c.plan, 'Plandauer Tourelemente', hours(h, 0)) + ttRow(c.fahren, 'davon Fahren', hours(fahren, 0)) +
            ttRow(null, 'Touren', num(touren)) + (inc ? ttRow(null, 'Monat', inc) : '');
        },
      },
      visualMap: {
        show: false, min: 0, max, dimension: 1, inRange: { color: c.seq.slice(0, 6) },
      },
      calendar: {
        range: [first, last], top: 24, left: 34, right: 8, cellSize: ['auto', 22], orient: 'horizontal',
        dayLabel: { firstDay: 1, nameMap: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], color: t.muted, fontSize: 10 },
        monthLabel: { nameMap: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'], color: t.ink2 },
        yearLabel: { show: false },
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        splitLine: { lineStyle: { color: t.axis, width: 1 } },
      },
      series: [{
        type: 'heatmap', coordinateSystem: 'calendar', cursor: 'pointer',
        data: rows.map((r) => ({
          value: [r.tag.slice(0, 10), r.plandauer_h ?? 0, r.touren ?? 0, r.fahren_h ?? 0],
          itemStyle: { opacity: !m || r.tag.startsWith(m) ? 1 : 0.4 },
        })),
      }],
    };
  });

  protected readonly profile = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const c = ac4Colors(this.theme.mode());
    const j = this.jupDays();
    const d = this.dispDays();
    if (!j.some((x) => x.dauer) && !d.some((x) => x.h)) return null;
    const hatch = this.theme.mode() === 'dark' ? HATCH_DARK : HATCH;
    return {
      aria: ariaDecal(),
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: t.ink2 } },
      grid: { left: 4, right: 8, top: 32, bottom: 4, outerBounds: { left: 4, right: 8, top: 32, bottom: 4 } },
      xAxis: { type: 'category', data: DAYS },
      yAxis: { type: 'value', name: 'h je Tag', nameTextStyle: { color: t.muted, align: 'left' }, axisLabel: { formatter: (v: number) => num(v) } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          return ttHead(DAYS[i]) + ttRow(c.plan, `Disposition, Ø je ${DAYS[i]} (${d[i].n} Tage)`, hours(d[i].h, 0)) +
            ttRow(c.plan, '… davon Fahren', hours(d[i].fahren, 0)) +
            ttRow(t.ink2, `JUP «${this.version()}»`, hours(j[i].dauer, 0)) + ttRow(null, '… Touren der Musterwoche', num(j[i].touren));
        },
      },
      series: [
        { type: 'bar', name: 'Disposition (Ø je Wochentag)', barGap: '12%', barMaxWidth: 22, data: d.map((x) => x.h),
          itemStyle: { color: c.plan, borderRadius: [4, 4, 0, 0] } },
        { type: 'bar', name: 'JUP-Musterwoche', barMaxWidth: 22, data: j.map((x) => x.dauer || null),
          itemStyle: { color: t.surface, borderColor: t.ink2, borderWidth: 1.5, borderRadius: [4, 4, 0, 0], decal: { ...hatch, color: t.axis } } },
      ],
    };
  });

  protected day(e: { data?: { value?: [string] } }): void {
    const tag = e?.data?.value?.[0];
    if (!tag) return;
    const m = tag.slice(0, 7);
    this.store.pickMonth(this.store.month() === m ? null : m);
  }
}
