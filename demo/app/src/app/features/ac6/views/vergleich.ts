import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { dateOnly, hours, num, pct } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartGroup } from '../../../shared/connect';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac6Colors } from '../data/palette';
import { Ac6Store, S1_NAME, S1_PERIOD } from '../data/store';
import { DAY_LONG } from '../data/week';

const signedPct = (v: number | null) => (v == null || !Number.isFinite(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v) * 100, 0)} %`);

/**
 * View 5 - plan against disposition, for the one version with a settled period: «Schichtbildung 1»,
 * 07.09.–12.12.2026. Two separate aggregates (queries vergleich / vergleich_wochen), never a row join: the JUP's
 * pattern week against the disposition's AVERAGE week in the period (hours of a weekday / number of that weekday
 * in the period, computed in the DAX), aligned by Tourstandort and weekday name (layout only). Gap = disposition
 * per week − plan. Three pictures: weekday profile, Tourstandorte as dumbbells sorted by gap, the 14 weeks of the
 * period against the pattern-week total. Clicking a weekday or a Tourstandort filters the page.
 */
@Component({
  selector: 'ac6-vergleich',
  styleUrl: './vergleich.css',
  encapsulation: ViewEncapsulation.None,
  imports: [NgxEchartsDirective, ChartResize, ChartCard, ChartGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.isS1()) {
      <app-card heading="Hält die Disposition, was die Musterwoche plant?" [q]="[store.vergleich, store.wochen]"
                emptyNote="Unter diesem Filter gibt es weder Plan noch Disposition.">
        <p class="ac6-answer">{{ answer() }}</p>
        <div class="ac6-legend">
          <span><i [style.background]="colors().jup"></i>JUP «{{ s1 }}», Musterwoche</span>
          <span><i [style.background]="colors().dispo"></i>Disposition, Ø Woche {{ period }}</span>
        </div>
        <div class="ac6-split ac6-split-wide">
          <div>
            <h3 class="ac6-h3">Je Wochentag</h3>
            <div echarts class="chart" style="height: 250px" [options]="tage()!" [theme]="theme.echartsTheme()" chartGroup="ac6-tag"
                 (chartClick)="day($any($event))" aria-label="Geplante Stunden je Wochentag: JUP gegen Disposition"></div>
            <h3 class="ac6-h3">Je Kalenderwoche des Zeitraums</h3>
            <div echarts class="chart" style="height: 230px" [options]="wochen()!" [theme]="theme.echartsTheme()"
                 aria-label="Disposition je Kalenderwoche gegen die Musterwoche"></div>
          </div>
          <div>
            <h3 class="ac6-h3">Je Tourstandort, sortiert nach Abstand</h3>
            <div echarts class="chart" [style.height.px]="tsHeight()" [options]="standorte()!" [theme]="theme.echartsTheme()"
                 (chartClick)="ts($any($event))" aria-label="Tourstandorte: JUP-Stunden gegen Disposition je Woche"></div>
          </div>
        </div>
        <p class="ac6-note">Verglichen werden gemeinsame Merkmale (Tourstandort, Wochentag des Tourbeginns, Personaltyp, Tätigkeit), keine Zeilen: Plan und Disposition haben im Modell keine Beziehung. Stunden = Dauer bzw. Plandauer der Tourelemente; die Disposition enthält alle Touren des Zeitraums. Nicht exportiert sind die Klassifikation (Controlling-Workbook) und die Regel der Tour-Arbeitszeit, deshalb vergleicht die Ansicht nur Dauern.</p>
      </app-card>
    } @else {
      <section class="card ac6-off">
        <h2 class="ac6-h2">Hält die Disposition, was die Musterwoche plant?</h2>
        <p>Diesen Vergleich gibt es nur für «{{ s1 }}»: nur diese Version hat einen geklärten Zeitraum ({{ period }}). Für «{{ store.versionName() }}» liefert die Quelle keine Gültigkeit (SAX-40), also kein Zeitfenster der Disposition.</p>
        <button type="button" class="btn" (click)="store.pickVersion(null)">«{{ s1 }}» zeigen</button>
      </section>
    }
  `,
})
export class VergleichView {
  protected readonly store = inject(Ac6Store);
  protected readonly theme = inject(ThemeService);
  protected readonly s1 = S1_NAME;
  protected readonly period = S1_PERIOD;
  protected readonly colors = computed(() => ac6Colors(this.theme.mode()));

  private readonly days = computed(() => {
    const plan = new Array(7).fill(0);
    const dispo = new Array(7).fill(0);
    for (const r of this.store.vergleich.rows()) {
      if (r.tag == null || r.tag > 6) continue;
      (r.seite === 'plan' ? plan : dispo)[r.tag] += r.h_je_woche ?? 0;
    }
    return { plan, dispo };
  });

  private readonly perTs = computed(() => {
    const m = new Map<string, { plan: number; dispo: number }>();
    for (const r of this.store.vergleich.rows()) {
      if (!r.tourstandort) continue;
      const e = m.get(r.tourstandort) ?? { plan: 0, dispo: 0 };
      if (r.seite === 'plan') e.plan += r.h_je_woche ?? 0;
      else e.dispo += r.h_je_woche ?? 0;
      m.set(r.tourstandort, e);
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v, gap: v.dispo - v.plan })).sort((a, b) => b.gap - a.gap);
  });

  protected readonly tsHeight = computed(() => Math.max(300, this.perTs().length * 20 + 40));

  protected readonly answer = computed(() => {
    const { plan, dispo } = this.days();
    const p = plan.reduce((s, v) => s + v, 0);
    const d = dispo.reduce((s, v) => s + v, 0);
    if (!p && !d) return '';
    const ts = this.perTs();
    const under = ts.filter((x) => x.plan > 0 && x.dispo < x.plan * 0.9).length;
    const onlyPlan = ts.filter((x) => x.plan > 0 && x.dispo === 0).length;
    const onlyDispo = ts.filter((x) => x.dispo > 0 && x.plan === 0).length;
    return `Die Disposition hält im Schnitt ${hours(d, 0)} je Woche gegen ${hours(p, 0)} der Musterwoche (${signedPct(p ? d / p - 1 : null)}). ` +
      `${under} Tourstandorte liegen mehr als 10 % unter dem Plan` + (onlyPlan || onlyDispo ? `; ${onlyPlan} nur im Plan, ${onlyDispo} nur in der Disposition.` : '.');
  });

  protected readonly tage = computed<EChartsCoreOption | null>(() => {
    const { plan, dispo } = this.days();
    if (!plan.some((v) => v) && !dispo.some((v) => v)) return null;
    const t = this.theme.tokens();
    const c = this.colors();
    const sel = this.store.tag();
    const op = (i: number) => (sel == null || sel === i ? 1 : 0.3);
    return {
      aria: ariaDecal(),
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0].dataIndex;
          return ttHead(DAY_LONG[i]) + ttRow(c.jup, 'JUP Musterwoche', hours(plan[i], 0)) + ttRow(c.dispo, 'Disposition Ø', hours(dispo[i], 0)) +
            ttRow(null, 'Abstand', signedPct(plan[i] ? dispo[i] / plan[i] - 1 : null));
        },
      },
      grid: { left: 4, right: 8, top: 22, bottom: 4, outerBounds: { left: 4, right: 8, top: 22, bottom: 4 } },
      xAxis: { type: 'category', data: ['0', '1', '2', '3', '4', '5', '6'], axisTick: { show: false },
        axisLabel: { color: t.ink2, fontFamily: FONT_NUM, formatter: (v: string) => this.store.dayLabel(Number(v)) } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (v: number) => num(v) } },
      series: [
        { name: 'JUP', type: 'bar', barMaxWidth: 18, barGap: '12%', cursor: 'pointer',
          data: plan.map((v, i) => ({ value: v, itemStyle: { color: c.jup, opacity: op(i), borderRadius: [4, 4, 0, 0] } })) },
        { name: 'Disposition', type: 'bar', barMaxWidth: 18, cursor: 'pointer',
          data: dispo.map((v, i) => ({ value: v, itemStyle: { color: c.dispo, opacity: op(i), borderRadius: [4, 4, 0, 0] } })),
          label: { show: true, position: 'top', color: t.ink2, fontSize: 10.5, fontFamily: FONT_NUM,
            formatter: (p: { dataIndex: number }) => signedPct(plan[p.dataIndex] ? dispo[p.dataIndex] / plan[p.dataIndex] - 1 : null) } },
      ],
    };
  });

  protected readonly wochen = computed<EChartsCoreOption | null>(() => {
    const ws = [...this.store.wochen.rows()].sort((a, b) => a.kw - b.kw);
    if (!ws.length) return null;
    const t = this.theme.tokens();
    const c = this.colors();
    const plan = ws[0].plan_h ?? 0;
    return {
      aria: ariaDecal(),
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: (ps: { dataIndex: number }[]) => {
          const w = ws[ps[0].dataIndex];
          return ttHead(`KW ${w.kw} (ab ${dateOnly(w.erster_tag)}, ${w.tage} Tage)`) + ttRow(c.dispo, 'Disposition', hours(w.dispo_h, 0)) +
            ttRow(null, 'Touren', num(w.dispo_touren)) + ttRow(c.jup, 'Musterwoche JUP', hours(plan, 0));
        },
      },
      grid: { left: 4, right: 96, top: 14, bottom: 4, outerBounds: { left: 4, right: 96, top: 14, bottom: 4 } },
      xAxis: { type: 'category', data: ws.map((w) => `KW ${w.kw}`), axisTick: { show: false }, axisLabel: { color: t.ink2, fontSize: 10.5 } },
      // the axis must hold the pattern-week line (echarts does not extend an axis for a markLine)
      yAxis: { type: 'value', max: (e: { max: number }) => Math.ceil(Math.max(e.max, plan) * 1.06), splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (v: number) => num(v) } },
      series: [{
        type: 'bar', barMaxWidth: 20,
        data: ws.map((w) => ({ value: w.dispo_h ?? 0, itemStyle: { color: c.dispo, borderRadius: [4, 4, 0, 0], opacity: w.tage < 7 ? 0.55 : 1 } })),
        markLine: {
          silent: true, symbol: 'none', data: [{ yAxis: plan }], lineStyle: { color: c.jup, width: 2, type: 'solid' },
          label: { position: 'end', color: t.ink2, fontSize: 11, formatter: `Musterwoche\n${hours(plan, 0)}` },
        },
      }],
    };
  });

  protected readonly standorte = computed<EChartsCoreOption | null>(() => {
    const rows = [...this.perTs()].reverse();                          // largest surplus at the top
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = this.colors();
    const sel = this.store.standortName();
    return {
      aria: ariaDecal(),
      tooltip: {
        confine: true,
        formatter: (p: { dataIndex: number }) => {
          const r = rows[p.dataIndex];
          return ttHead(r.name) + ttRow(c.jup, 'JUP Musterwoche', hours(r.plan, 0)) + ttRow(c.dispo, 'Disposition Ø Woche', hours(r.dispo, 0)) +
            ttRow(null, 'Abstand', `${signedPct(r.plan ? r.dispo / r.plan - 1 : null)} (${r.gap >= 0 ? '+' : '−'}${num(Math.abs(r.gap), 0)} h)`) +
            (r.plan === 0 ? ttRow(null, '', 'nur in der Disposition') : r.dispo === 0 ? ttRow(null, '', 'nur im Plan') : '');
        },
      },
      grid: { left: 8, right: 64, top: 6, bottom: 8, outerBounds: { left: 8, right: 64, top: 6, bottom: 8 } },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (v: number) => num(v) } },
      yAxis: {
        type: 'category', data: rows.map((r) => r.name), axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: t.ink2, width: 170, overflow: 'truncate', fontSize: 11.5, formatter: (v: string) => (v === sel ? `{s|${v}}` : v),
          rich: { s: { color: t.ink, fontWeight: 700, fontSize: 11.5 } } },
      },
      series: [{
        type: 'custom', cursor: 'pointer',
        encode: { x: [1, 2], y: 0 },
        data: rows.map((r, i) => [i, r.plan, r.dispo]),
        renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[] }) => {
          const y = api.value(0);
          const a = api.coord([api.value(1), y]);
          const b = api.coord([api.value(2), y]);
          const dim = sel && rows[y].name !== sel ? 0.35 : 1;
          return {
            type: 'group', children: [
              { type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: t.axis, lineWidth: 2, opacity: dim } },
              { type: 'circle', shape: { cx: a[0], cy: a[1], r: 5 }, style: { fill: c.jup, stroke: t.surface, lineWidth: 2, opacity: dim } },
              { type: 'circle', shape: { cx: b[0], cy: b[1], r: 5 }, style: { fill: c.dispo, stroke: t.surface, lineWidth: 2, opacity: dim } },
            ],
          };
        },
      }],
    };
  });

  protected day(e: { dataIndex?: number }): void {
    if (e?.dataIndex == null) return;
    this.store.pickTag(this.store.tag() === e.dataIndex ? null : e.dataIndex);
  }
  protected ts(e: { dataIndex?: number }): void {
    if (e?.dataIndex == null) return;
    const r = [...this.perTs()].reverse()[e.dataIndex];
    if (!r) return;
    const x = this.store.rankOf('standort', r.name);
    this.store.pickStandort(this.store.standort() === x ? null : x);
  }

  protected readonly pctFmt = pct;
}
