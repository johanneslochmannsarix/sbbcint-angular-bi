import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { dayMs, num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac7Store } from '../data/store';
import { Ga, ListeRow } from '../data/types';
import { ac7Colors } from '../data/palette';
import { stintDays } from './timeline';
import { UiOption, UiSeg } from '../../../shared/ui';

type Measure = 'dauer' | 'luecke';
interface Group { label: string; ga: Ga; older: boolean; pts: { v: number; person: string }[] }

/** gap between the two stints in days: newest start minus the older stint's end (negative = overlap) */
function gapDays(r: ListeRow): number | null {
  const a = dayMs(r.einsatz1_von);
  const b = dayMs(r.einsatz2_bis);
  return a == null || b == null ? null : Math.round((a - b) / 86_400_000);
}

/** a stable sub-band offset per person (jitter), so a point does not jump between renders */
function jitter(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000 - 0.5) * 0.5;
}

/**
 * View 4 - stint lengths: one box per Geschäftsart and stint (box plot via echarts' built-in 'boxplot' dataset
 * transform) with every person as a point on top; or the gap between the two stints. Durations are arithmetic on the
 * returned dates (README «App-side computations»). Hover links to the timeline, a click opens the person.
 */
@Component({
  selector: 'ac7-stints',
  imports: [NgxEchartsDirective, ChartCard, ChartResize, UiSeg],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card [heading]="measure() === 'dauer' ? 'Wie lange dauern die Einsätze?' : 'Wie dicht folgen die zwei Einsätze aufeinander?'"
              [sub]="measure() === 'dauer' ? 'Tage je Einsatz, Box = mittlere Hälfte, Strich = Median; jeder Punkt eine Person' : 'Tage zwischen Ende des vorletzten und Beginn des letzten Einsatzes; unter 0 = überlappend'"
              [q]="store.liste">
      <ui-seg card-tools size="sm" ariaLabel="Kennzahl" [options]="measureOptions" [value]="measure()" (valueChange)="measure.set($event)" />
      <div echarts class="chart h-320" [options]="options()!" [theme]="theme.echartsTheme()" (chartInit)="chart.set($event)"
           (chartClick)="click($event)" (chartMouseOver)="over($event)" (chartMouseOut)="store.hover.set(null)"></div>
    </app-card>
  `,
})
export class StintsView {
  protected readonly store = inject(Ac7Store);
  protected readonly theme = inject(ThemeService);
  protected readonly measure = signal<Measure>('dauer');
  protected readonly measureOptions: UiOption<Measure>[] = [
    { value: 'dauer', label: 'Dauer' },
    { value: 'luecke', label: 'Abstand' },
  ];
  protected readonly chart = signal<ECharts | null>(null);

  private readonly groups = computed<Group[]>(() => {
    const rows = this.store.liste.rows();
    const out: Group[] = [];
    const add = (label: string, ga: Ga, older: boolean, pick: (r: ListeRow) => number | null, keep: (r: ListeRow) => boolean) => {
      const pts = rows.filter(keep).map((r) => ({ v: pick(r), person: r.person_sk })).filter((p): p is { v: number; person: string } => p.v != null);
      if (pts.length) out.push({ label, ga, older, pts });
    };
    if (this.measure() === 'dauer') {
      for (const ga of ['AÜ', 'DL'] as Ga[]) {
        add(`${ga} · letzter`, ga, false, (r) => stintDays(r.einsatz1_von, r.einsatz1_bis), (r) => r.einsatz1_geschaeftsart === ga);
        add(`${ga} · vorletzter`, ga, true, (r) => stintDays(r.einsatz2_von, r.einsatz2_bis), (r) => r.einsatz2_geschaeftsart === ga);
      }
    } else {
      for (const ga of ['AÜ', 'DL', 'AÜ+DL'] as Ga[]) add(ga, ga, false, gapDays, (r) => r.geschaeftsart === ga);
    }
    return out;
  });
  private readonly points = computed(() => this.groups().flatMap((g, gi) => g.pts.map((p) => ({ ...p, gi }))));

  constructor() {
    effect(() => {
      const ch = this.chart();
      const h = this.store.hover();
      if (!ch || ch.isDisposed()) return;
      ch.dispatchAction({ type: 'downplay', seriesId: 'pts' });
      if (!h) return;
      const idx = this.points().map((p, i) => (p.person === h ? i : -1)).filter((i) => i >= 0);
      if (idx.length) ch.dispatchAction({ type: 'highlight', seriesId: 'pts', dataIndex: idx });
    });
  }

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const gs = this.groups();
    if (!gs.length) return null;
    const t = this.theme.tokens();
    const c = ac7Colors(t);
    const labels = gs.map((g) => g.label);
    const pts = this.points();
    const store = this.store;
    const unit = this.measure() === 'dauer' ? 'Tage' : 'Tage Abstand';
    return {
      animation: false,
      aria: ariaDecal(),
      grid: { left: 8, right: 20, top: 12, bottom: 30, outerBounds: { left: 8, right: 20, top: 12, bottom: 30 } },
      dataset: [
        { source: gs.map((g) => g.pts.map((p) => p.v)) },
        { fromDatasetIndex: 0, transform: { type: 'boxplot', config: { itemNameFormatter: (p: { value: number }) => labels[p.value] } } },
      ],
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: { seriesType: string; value: (string | number)[]; dataIndex: number }) => {
          if (p.seriesType === 'boxplot') {
            const v = p.value;
            const g = gs.find((x) => x.label === v[0]);
            return ttHead(String(v[0])) + ttRow(null, 'Einsätze', num(g?.pts.length)) + ttRow(null, 'Median', `${num(Number(v[3]))} ${unit}`)
              + ttRow(null, 'mittlere Hälfte', `${num(Number(v[2]))} – ${num(Number(v[4]))}`) + ttRow(null, 'Spanne (1,5 IQR)', `${num(Number(v[1]))} – ${num(Number(v[5]))}`);
          }
          const pt = pts[p.dataIndex];
          const r = store.listeBy().get(pt.person);
          return ttHead(r ? store.personLabel(r) : pt.person) + ttRow(c.ga[gs[pt.gi].ga], gs[pt.gi].label, `${num(pt.v)} ${unit}`)
            + '<div style="opacity:.7;margin-top:4px">Klicken: Person öffnen</div>';
        },
      },
      xAxis: { type: 'value', name: unit, nameLocation: 'middle', nameGap: 22, splitLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: 'category', data: labels, inverse: true, axisTick: { show: false }, axisLabel: { color: t.ink2 } },
      series: [
        {
          type: 'boxplot', datasetIndex: 1, encode: { y: 'ItemName', x: ['Low', 'Q1', 'Q2', 'Q3', 'High'] }, boxWidth: [10, 22], silent: false,
          itemStyle: { color: 'transparent', borderColor: t.ink2, borderWidth: 1.5 },
          emphasis: { disabled: true },
        },
        {
          type: 'scatter', id: 'pts', symbolSize: 7,
          data: pts.map((p) => ({
            value: [p.v, p.gi + jitter(p.person)],
            itemStyle: { color: c.ga[gs[p.gi].ga], opacity: gs[p.gi].older ? 0.55 : 0.85, borderColor: t.surface, borderWidth: 1 },
          })),
          encode: { x: 0, y: 1 },
          emphasis: { scale: 1.8, itemStyle: { borderColor: t.ink, borderWidth: 2, opacity: 1 } },
          markLine: this.measure() === 'luecke' ? { symbol: 'none', silent: true, lineStyle: { color: t.axis, type: 'solid' }, label: { show: false }, data: [{ xAxis: 0 }] } : undefined,
        },
      ],
    };
  });

  protected click(e: { seriesId?: string; dataIndex?: number }): void {
    if (e.seriesId !== 'pts' || e.dataIndex == null) return;
    const p = this.points()[e.dataIndex];
    if (!p) return;
    this.chart()?.dispatchAction({ type: 'hideTip' });
    this.store.openDrawer(p.person);
  }
  protected over(e: { seriesId?: string; dataIndex?: number }): void {
    if (e.seriesId !== 'pts' || e.dataIndex == null) return;
    const p = this.points()[e.dataIndex];
    if (p && this.store.hover() !== p.person) this.store.hover.set(p.person);
  }
}
