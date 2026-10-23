import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac6Colors } from '../data/palette';
import { Ac6Store, HEAT_LABEL, HeatMeasure } from '../data/store';
import { HeatRow } from '../data/types';

const fmt = (m: HeatMeasure, v: number | null) => (m === 'dauer_h' || m === 'fahren_h' ? hours(v, 0) : num(v));

/**
 * View 1 - Tourstandort x Musterwochentag. Rows grouped by the Tourstandort's Firma (bands), inside a Firma by
 * planned hours; columns Mo … So of the tour start. Colour = the measure picked on a KPI tile, bucketed into six
 * quantile steps of the returned cells (layout only) on the single-hue Stahlblau ramp. Clicking a cell drills to
 * that Tourstandort (its tour list opens below); clicking a column header filters the weekday. Answers «where and
 * on which weekday does the plan put its hours?».
 */
@Component({
  selector: 'ac6-heatmap',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wo und an welchem Tag plant die Version ihre Stunden?" [q]="store.heat" emptyNote="Unter diesem Filter plant die Version keinen Tourstandort.">
      <div card-tools class="ac6-tools">
        <div class="seg seg-sm" role="group" aria-label="Messgrösse">
          @for (m of measures; track m) {
            <button type="button" [attr.aria-pressed]="store.heatMeasure() === m" (click)="store.heatMeasure.set(m)" [title]="label[m]">{{ short[m] }}</button>
          }
        </div>
      </div>
      <p class="ac6-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"
           aria-label="Raster Tourstandort mal Musterwochentag; Zelle anklicken öffnet den Tourstandort"></div>
      <p class="ac6-note">Tag = Wochentag des Tourbeginns, wie im Bericht. Farbe in sechs Stufen nach Quantilen der gezeigten Zellen; leere Zellen plant die Version nicht.</p>
    </app-card>
  `,
})
export class HeatmapView {
  protected readonly store = inject(Ac6Store);
  protected readonly theme = inject(ThemeService);
  protected readonly measures: HeatMeasure[] = ['dauer_h', 'touren', 'tourelemente', 'fahren_h'];
  protected readonly label = HEAT_LABEL;
  protected readonly short: Record<HeatMeasure, string> = { dauer_h: 'Dauer', touren: 'Touren', tourelemente: 'Elemente', fahren_h: 'Fahren' };

  /** row order: Firma by total, then Tourstandort by total, both by the shown measure (layout only) */
  private readonly layout = computed(() => {
    const m = this.store.heatMeasure();
    const rows = this.store.heat.rows().filter((r) => r.tourstandort);
    const ts = new Map<string, { firma: string; total: number }>();
    const firm = new Map<string, number>();
    for (const r of rows) {
      const v = (r[m] as number | null) ?? 0;
      const e = ts.get(r.tourstandort!) ?? { firma: r.firma ?? '–', total: 0 };
      e.total += v;
      ts.set(r.tourstandort!, e);
      firm.set(r.firma ?? '–', (firm.get(r.firma ?? '–') ?? 0) + v);
    }
    const order = [...ts.entries()].sort((a, b) => (firm.get(b[1].firma)! - firm.get(a[1].firma)!) || a[1].firma.localeCompare(b[1].firma) || b[1].total - a[1].total);
    const days = [...new Set(rows.map((r) => r.tag).filter((d): d is number => d != null))].sort((a, b) => a - b);
    return { rows, order, days, firm };
  });

  protected readonly height = computed(() => Math.max(240, this.layout().order.length * 21 + 70));

  protected readonly answer = computed(() => {
    const { rows, order } = this.layout();
    if (!rows.length) return '';
    const m = this.store.heatMeasure();
    const total = order.reduce((s, [, e]) => s + e.total, 0);
    const top = order.slice().sort((a, b) => b[1].total - a[1].total)[0];
    const max = rows.reduce((a, r) => (((r[m] as number) ?? 0) > ((a[m] as number) ?? 0) ? r : a), rows[0]);
    return `${top[0]} trägt ${num(total ? (top[1].total / total) * 100 : 0, 1)} % (${fmt(m, top[1].total)}); die dichteste Zelle ist ${max.tourstandort}, ${this.store.dayLabel(max.tag)}, mit ${fmt(m, max[m] as number)}.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const { rows, order, days } = this.layout();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac6Colors(this.theme.mode());
    const m = this.store.heatMeasure();
    const selTs = this.store.standortName();
    const selDay = this.store.tag();
    const yNames = order.map(([n]) => n).reverse();                    // first row at the top
    const yIdx = new Map(yNames.map((n, i) => [n, i]));
    const xIdx = new Map(days.map((d, i) => [d, i]));
    const vals = rows.map((r) => (r[m] as number | null) ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
    const qs = [1, 2, 3, 4, 5].map((i) => vals[Math.min(vals.length - 1, Math.floor((i / 6) * vals.length))] ?? 0);
    const ramp = c.seq.slice(1);
    const pieces = [0, ...qs].map((lo, i, a) => ({ gt: i === 0 ? 0 : lo, lte: i < a.length - 1 ? a[i + 1] : undefined, color: ramp[i] }));
    const byKey = new Map(rows.map((r) => [`${r.tourstandort}|${r.tag}`, r]));
    // Firma bands: consecutive rows of one Firma
    const bands: object[] = [];
    let i0 = 0;
    for (let i = 1; i <= order.length; i++) {
      if (i === order.length || order[i][1].firma !== order[i0][1].firma) {
        const top = yNames.length - 1 - i0;
        const bottom = yNames.length - i;
        bands.push([{ yAxis: yNames[bottom], name: order[i0][1].firma, itemStyle: { color: (bands.length % 2) ? t.grid : 'transparent', opacity: 0.45 } },
          { yAxis: yNames[top] }]);
        i0 = i;
      }
    }
    return {
      aria: ariaDecal(),
      animation: false,
      tooltip: {
        confine: true,
        formatter: (p: { data?: { key?: string } }) => {
          const r: HeatRow | undefined = p.data?.key ? byKey.get(p.data.key) : undefined;
          if (!r) return '';
          return ttHead(`${r.tourstandort} · ${this.store.dayLabel(r.tag)}`) + ttRow(null, 'Firma', r.firma ?? '–') +
            ttRow(c.jup, 'Dauer Tourelemente', hours(r.dauer_h, 1)) + ttRow(c.fahren, 'davon Fahren', hours(r.fahren_h, 1)) +
            ttRow(null, 'Touren', num(r.touren)) + ttRow(null, 'Tourelemente', num(r.tourelemente));
        },
      },
      grid: { left: 8, right: 150, top: 26, bottom: 8, outerBounds: { left: 8, right: 150, top: 26, bottom: 8 } },
      xAxis: {
        type: 'category', position: 'top', data: days.map((d) => this.store.dayLabel(d)), triggerEvent: true,
        axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false },
        axisLabel: { color: t.ink, fontFamily: FONT_NUM, fontWeight: 600, cursor: 'pointer',
          formatter: (v: string, i: number) => (selDay != null && days[i] === selDay ? `{s|${v}}` : v),
          rich: { s: { color: t.ink, fontFamily: FONT_NUM, fontWeight: 700, borderColor: t.ink, borderWidth: 0, padding: [0, 0, 2, 0] } } },
      },
      yAxis: {
        type: 'category', data: yNames, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: t.ink2, width: 190, overflow: 'truncate', fontSize: 11.5,
          formatter: (v: string) => (v === selTs ? `{s|${v}}` : v), rich: { s: { color: t.ink, fontWeight: 700, fontSize: 11.5 } } },
      },
      visualMap: { type: 'piecewise', show: false, dimension: 2, pieces, outOfRange: { color: t.grid } },
      series: [{
        type: 'heatmap', cursor: 'pointer',
        data: rows.filter((r) => yIdx.has(r.tourstandort!) && xIdx.has(r.tag!)).map((r) => ({
          key: `${r.tourstandort}|${r.tag}`,
          value: [xIdx.get(r.tag!)!, yIdx.get(r.tourstandort!)!, (r[m] as number | null) ?? 0],
          itemStyle: {
            borderColor: r.tourstandort === selTs ? t.ink : t.surface, borderWidth: r.tourstandort === selTs ? 1.5 : 2,
            opacity: (selDay == null || r.tag === selDay) && (!selTs || r.tourstandort === selTs) ? 1 : 0.4,
          },
        })),
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } },
        markArea: {
          silent: true, data: bands,
          label: { show: true, position: 'right', color: t.muted, fontSize: 11, width: 140, overflow: 'truncate' },
        },
      }],
    };
  });

  protected click(e: { componentType?: string; value?: string; data?: { key?: string } }): void {
    if (e?.componentType === 'xAxis' && e.value) {
      const nr = this.store.tage().find((d) => d.label === e.value)?.rang ?? null;
      this.store.pickTag(this.store.tag() === nr ? null : nr);
      return;
    }
    const ts = e?.data?.key?.split('|')[0];
    if (!ts) return;
    const r = this.store.rankOf('standort', ts);
    this.store.pickStandort(this.store.standort() === r ? null : r);
  }
}
