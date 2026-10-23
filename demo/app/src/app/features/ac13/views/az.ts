import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { dateOnly, minutes, num, pct } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac13Colors } from '../data/palette';
import { Ac13Store, AzMeasure } from '../data/store';
import { PunktRow } from '../data/types';

const CAP = 1440;
const OBSERVATION_14H = 820;

/** quantile of sorted values (layout only: used for the angerechnete-Zeit boxes, the model has sums only) */
function q(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function jitter(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

/**
 * View 2 - «AZ je Tour»: how long are the tours of the month per Tour-Standort, and how many reach 12 h / 14 h?
 * Arbeitszeit v1 (rule v1-plandauer_minus_pausen_dienstfahrt; boxes from DAX quantiles p05/p25/p50/p75/p95) or
 * angerechnete Zeit (boxes = quantiles of the returned values, layout only). The 12H / 14H lines belong to
 * angerechnete Zeit (≥ 720 / ≥ 840 min, as ruled) and are drawn only on that axis; the ≈ 820 min fit from the
 * Zedas sample is a dashed «Beobachtung, nicht Regel». Every tour is a point (large mode); tours over 24 h (data
 * oddity, up to ≈ 170 h) are counted, not drawn. A point opens the tour drill.
 */
@Component({
  selector: 'ac13-az',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wie lang sind die Touren je Standort, und wie viele erreichen 12 h oder 14 h?" [q]="[store.box, store.punkte]"
              emptyNote="Für diese Auswahl gibt es keine Tour im Monat.">
      <div card-tools class="ac13-tools">
        <div class="seg seg-sm" role="group" aria-label="Messgrösse">
          <button type="button" [attr.aria-pressed]="store.azMeasure() === 'arbeitszeit'" (click)="store.azMeasure.set('arbeitszeit')">Arbeitszeit v1</button>
          <button type="button" [attr.aria-pressed]="store.azMeasure() === 'angerechnet'" (click)="store.azMeasure.set('angerechnet')">angerechnete Zeit</button>
        </div>
      </div>
      <p class="ac13-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"
           aria-label="Verteilung je Tour-Standort; Punkt anklicken öffnet die Tour"></div>
      <p class="ac13-note">{{ note() }}</p>
    </app-card>
  `,
})
export class AzView {
  protected readonly store = inject(Ac13Store);
  protected readonly theme = inject(ThemeService);

  private readonly m = computed<AzMeasure>(() => this.store.azMeasure());
  private val(r: PunktRow, m: AzMeasure): number | null {
    return m === 'arbeitszeit' ? r.arbeitszeit_min : r.angerechnet_min;
  }

  private readonly layout = computed(() => {
    const m = this.m();
    const box = this.store.box.rows().filter((r) => !r.ist_gesamt).sort((a, b) => b.touren - a.touren);
    const alle = this.store.box.rows().find((r) => r.ist_gesamt) ?? null;
    const names = box.map((r) => r.tour_standort);
    const pts = this.store.punkte.rows();
    const by = new Map<string, number[]>();
    for (const p of pts) {
      const v = this.val(p, m);
      if (v == null || !p.tour_standort) continue;
      (by.get(p.tour_standort) ?? by.set(p.tour_standort, []).get(p.tour_standort)!).push(v);
    }
    for (const a of by.values()) a.sort((x, y) => x - y);
    const boxes = names.map((n) => {
      if (m === 'arbeitszeit') {
        const r = box.find((b) => b.tour_standort === n)!;
        return [r.p05, r.p25, r.p50, r.p75, r.p95];
      }
      const a = by.get(n) ?? [];
      return a.length ? [q(a, 0.05), q(a, 0.25), q(a, 0.5), q(a, 0.75), q(a, 0.95)] : [null, null, null, null, null];
    });
    const filled = pts.filter((p) => p.angerechnet_min != null).length;
    const over = pts.filter((p) => (this.val(p, m) ?? 0) > CAP).length;
    return { box, alle, names, pts, boxes, filled, over };
  });

  protected readonly height = computed(() => Math.max(260, this.layout().names.length * 30 + 70));

  protected readonly answer = computed(() => {
    const { alle, pts, filled } = this.layout();
    if (!alle) return '';
    if (this.m() === 'arbeitszeit') {
      return `Median ${minutes(alle.p50)} Arbeitszeit v1 je Tour, die mittlere Hälfte zwischen ${minutes(alle.p25)} und ${minutes(alle.p75)}; `
        + `${num(alle.ge12)} Touren ≥ 12 h und ${num(alle.ge14)} ≥ 14 h (auf angerechneter Zeit).`;
    }
    return `Angerechnete Zeit liegt für ${num(filled)} von ${num(pts.length)} Touren vor (${pct(pts.length ? filled / pts.length : null, 0)}); `
      + `${num(alle.ge12)} davon erreichen 12 h (≥ 720 min), ${num(alle.ge14)} 14 h (≥ 840 min).`;
  });

  protected readonly note = computed(() => {
    const { over, alle } = this.layout();
    const s = this.store.stand.rows()[0];
    const base = this.m() === 'arbeitszeit'
      ? `${s?.hinweis_arbeitszeit ?? ''} Box = 5 / 25 / 50 / 75 / 95 % (DAX).`
      : `${s?.hinweis_angerechnet ?? ''} ${s?.hinweis_14h ?? ''} Box = Quantile der gezeigten Touren mit angerechneter Zeit.`;
    const extra = over ? ` ${num(over)} Touren über 24 h sind gezählt, aber nicht gezeichnet.` : '';
    const neg = alle?.negativ ? ` ${num(alle.negativ)} Tour mit negativer Arbeitszeit bleibt sichtbar.` : '';
    return base + extra + neg;
  });

  /** scatter points [value, jittered row, index into punkte] - layout only; also the click lookup (large mode) */
  private readonly points = computed(() => {
    const { names, pts } = this.layout();
    const m = this.m();
    const yIdx = new Map(names.map((n, i) => [n, i]));
    return pts
      .map((p, i) => ({ p, i, v: this.val(p, m) }))
      .filter((x) => x.v != null && x.v <= CAP && x.p.tour_standort != null && yIdx.has(x.p.tour_standort))
      .map((x) => [x.v!, yIdx.get(x.p.tour_standort!)! + jitter(x.p.tour) * 0.56, x.i]);
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const { names, pts, boxes } = this.layout();
    if (!names.length) return null;
    const t = this.theme.tokens();
    const c = ac13Colors(this.theme.mode());
    const m = this.m();
    const color = m === 'arbeitszeit' ? c.az : c.anger;
    const selTour = this.store.tour();
    const data = this.points();
    const minV = Math.min(0, ...data.map((d) => d[0]));
    const lines = m === 'angerechnet' ? [
      { xAxis: 720, label: { formatter: '12 h', color: t.ink2 }, lineStyle: { color: t.ink2, type: 'solid', width: 1.5 } },
      { xAxis: 840, label: { formatter: '14 h', color: t.ink2 }, lineStyle: { color: t.ink2, type: 'solid', width: 1.5 } },
      { xAxis: OBSERVATION_14H, label: { formatter: '≈ 820: Beobachtung, nicht Regel', color: t.muted, position: 'insideEndTop', fontSize: 10 },
        lineStyle: { color: t.muted, type: 'dashed', width: 1 } },
    ] : [];
    return {
      aria: ariaDecal(),
      animation: false,
      grid: { left: 8, right: 24, top: 24, bottom: 28, outerBounds: { left: 8, right: 24, top: 24, bottom: 28 } },
      tooltip: { confine: true },
      xAxis: { type: 'value', min: minV, max: CAP, interval: 120, name: 'min', nameGap: 6,
        axisLabel: { fontFamily: FONT_NUM, formatter: (v: number) => `${v / 60} h` } },
      yAxis: { type: 'category', data: names, inverse: true, axisTick: { show: false },
        axisLabel: { color: t.ink2, fontSize: 11.5, formatter: (v: string) => v.replace(/^CD - /, '') } },
      series: [
        {
          type: 'boxplot', name: m === 'arbeitszeit' ? 'Arbeitszeit v1' : 'angerechnete Zeit', boxWidth: [8, 16],
          itemStyle: { color: 'transparent', borderColor: t.ink2, borderWidth: 1.5 }, z: 3,
          data: boxes.map((b) => b.map((v) => v ?? '-')),
          tooltip: {
            formatter: (p: { dataIndex: number }) => {
              const b = boxes[p.dataIndex];
              const r = this.layout().box[p.dataIndex];
              return ttHead(names[p.dataIndex]) + ttRow(null, 'Touren', num(r?.touren)) + ttRow(null, '95 %', minutes(b[4]))
                + ttRow(null, '75 %', minutes(b[3])) + ttRow(color, 'Median', minutes(b[2])) + ttRow(null, '25 %', minutes(b[1]))
                + ttRow(null, '5 %', minutes(b[0])) + ttRow(null, '≥ 12 h / ≥ 14 h', `${num(r?.ge12)} / ${num(r?.ge14)}`);
            },
          },
          markLine: lines.length ? { symbol: 'none', silent: true, data: lines } : undefined,
        },
        {
          type: 'scatter', name: 'Touren', large: true, largeThreshold: 2000, symbolSize: 4, cursor: 'pointer',
          itemStyle: { color, opacity: this.theme.mode() === 'dark' ? 0.6 : 0.38 }, z: 2, data,
          tooltip: {
            formatter: (p: { data: number[] }) => {
              const r = pts[p.data[2]];
              return r ? ttHead(`${r.tour_standort} · ${dateOnly(r.datum)}`) + ttRow(c.az, 'Arbeitszeit v1', minutes(r.arbeitszeit_min))
                + ttRow(c.anger, 'angerechnete Zeit', minutes(r.angerechnet_min)) + ttRow(null, 'Plandauer', minutes(r.plandauer_min))
                + (r.offen ? ttRow(null, 'Tour', 'offen') : '') : '';
            },
          },
        },
        ...(selTour ? [{
          type: 'scatter', name: 'gewählt', symbolSize: 11, silent: true, z: 6,
          itemStyle: { color, borderColor: t.ink, borderWidth: 2 },
          data: data.filter((d) => pts[d[2]].tour === selTour),
        }] : []),
      ],
    };
  });

  protected click(e: { seriesType?: string; seriesName?: string; dataIndex?: number; data?: number[] }): void {
    if (e?.seriesType !== 'scatter' || e.seriesName !== 'Touren') return;
    const d = e.data ?? (e.dataIndex != null ? this.points()[e.dataIndex] : undefined);
    const r = d ? this.store.punkte.rows()[d[2]] : undefined;
    if (r) this.store.openTour(r.tour);
  }
}
