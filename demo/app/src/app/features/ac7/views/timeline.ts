import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { dateOnly, dateShort, dayMs, num, today } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac7Store, Sort } from '../data/store';
import { Ga, ListeRow } from '../data/types';
import { STATUS_GLYPH, ac7Colors } from '../data/palette';

const DAY = 86_400_000;
const LANES_VISIBLE = 26;

interface Bar {
  lane: number;
  person: string;
  stint: 1 | 2;
  von: number;
  bis: number;
  ga: Ga | null;
  ort: string | null;
  orte: number | null;
  auftrag: string | null;
  austritt: number | null;
}

/** length of a stint in days (layout arithmetic on returned dates, README «App-side computations») */
export function stintDays(von: string | null, bis: string | null): number | null {
  const a = dayMs(von);
  const b = dayMs(bis);
  return a == null || b == null ? null : Math.round((b - a) / DAY);
}

/** AKTIV although neither shown stint spans today (the newest starts later): the form's «last two» hide the current one */
export function activeByHiddenStint(r: ListeRow, now = today()): boolean {
  if (r.status_code !== 'AKTIV') return false;
  const spans = (v: string | null, b: string | null) => {
    const a = dayMs(v);
    const e = dayMs(b);
    return a != null && e != null && a <= now && e >= now;
  };
  return !spans(r.einsatz1_von, r.einsatz1_bis) && !spans(r.einsatz2_von, r.einsatz2_bis);
}

function sortRows(rows: ListeRow[], sort: Sort): ListeRow[] {
  const start = (r: ListeRow) => dayMs(r.einsatz1_von) ?? 0;
  const len = (r: ListeRow) => stintDays(r.einsatz1_von, r.einsatz1_bis) ?? -1;
  const out = rows.slice();
  if (sort === 'start') out.sort((a, b) => start(a) - start(b));
  else if (sort === 'dauer') out.sort((a, b) => len(b) - len(a) || start(a) - start(b));
  else out.sort((a, b) => (a.status_code === b.status_code ? 0 : a.status_code === 'AKTIV' ? -1 : 1) || start(a) - start(b));
  return out;
}

/**
 * View 2 (hero) - Einsatz-Timeline: one lane per person, the last two stints as bars on one time axis, coloured by
 * the stint's Geschäftsart (the older stint lighter), today as a line, Austritt as a tick. dataZoom on both axes
 * (lanes and time). Hover links to the stint chart (store.hover), a click opens the person drawer.
 */
@Component({
  selector: 'ac7-timeline',
  imports: [NgxEchartsDirective, ChartCard, ChartResize],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Seit wann und wie lange ist wer verliehen?" [sub]="sub()" [q]="store.liste"
              emptyNote="Kein Eintrag unter diesem Filter. Einen Filter in der Leiste oben aufheben.">
      <div card-tools class="ac7-tools">
        <span class="ac7-tools-label" id="ac7-sort-l">Sortierung</span>
        <div class="seg seg-sm" role="group" aria-labelledby="ac7-sort-l">
          <button type="button" [attr.aria-pressed]="store.sort() === 'status'" (click)="store.setSort('status')">Status</button>
          <button type="button" [attr.aria-pressed]="store.sort() === 'start'" (click)="store.setSort('start')">Beginn</button>
          <button type="button" [attr.aria-pressed]="store.sort() === 'dauer'" (click)="store.setSort('dauer')">Dauer</button>
        </div>
      </div>
      <div echarts class="chart ac7-timeline" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()"
           (chartInit)="chart.set($event)" (chartClick)="click($event)" (chartMouseOver)="over($event)" (chartMouseOut)="store.hover.set(null)"></div>
      <div class="legend-inline ac7-legend" aria-label="Legende">
        <span><i class="key" [style.background]="c().ga['AÜ']"></i>AÜ-Einsatz</span>
        <span><i class="key" [style.background]="c().ga['DL']"></i>DL-Einsatz</span>
        <span><i class="key ac7-key-older" [style.background]="c().ga['AÜ']"></i>vorletzter Einsatz (heller)</span>
        <span><i class="key ac7-key-line"></i>heute</span>
        <span><i class="key ac7-key-tick"></i>Austritt (Vertragsende)</span>
        <span>■ aktiv · □ inaktiv</span>
        <span>◆ aktiv durch einen nicht gezeigten Einsatz</span>
      </div>
      <p class="chart-note">Einsatzzeitraum = frühester bis spätester Tag der Touren eines RT&amp;S-Auftrags (inkl. geplanter Touren), «letzte zwei» nach
        spätestem Ende. {{ hidden() ? hidden() + ' Personen sind aktiv durch einen dritten Einsatz, weil ihr neuester Einsatz erst beginnt (◆).' : '' }}</p>
    </app-card>
  `,
})
export class TimelineView {
  protected readonly store = inject(Ac7Store);
  protected readonly theme = inject(ThemeService);
  protected readonly chart = signal<ECharts | null>(null);
  protected readonly c = computed(() => ac7Colors(this.theme.tokens()));

  private readonly rows = computed(() => sortRows(this.store.liste.rows(), this.store.sort()));
  protected readonly hidden = computed(() => this.rows().filter((r) => activeByHiddenStint(r)).length);
  protected readonly height = computed(() => Math.max(220, Math.min(this.rows().length, LANES_VISIBLE) * 21 + 96));
  protected readonly sub = computed(() => {
    const n = this.rows().length;
    return n ? `${num(n)} Personen, je eine Zeile; Zeilen scrollen mit dem Regler rechts, Zeit mit dem Regler unten` : '';
  });

  private readonly bars = computed<Bar[]>(() => {
    const out: Bar[] = [];
    this.rows().forEach((r, lane) => {
      const austritt = dayMs(r.austritt);
      const push = (stint: 1 | 2, v: string | null, b: string | null, ga: Ga | null, ort: string | null, orte: number | null, auftrag: string | null) => {
        const von = dayMs(v);
        const bis = dayMs(b);
        if (von == null || bis == null) return;
        out.push({ lane, person: r.person_sk, stint, von, bis: bis + DAY, ga, ort, orte, auftrag, austritt });
      };
      push(2, r.einsatz2_von, r.einsatz2_bis, r.einsatz2_geschaeftsart, r.einsatz2_ort, r.einsatz2_anzahl_orte, r.einsatz2_auftrag);
      push(1, r.einsatz1_von, r.einsatz1_bis, r.einsatz1_geschaeftsart, r.einsatz1_ort, r.einsatz1_anzahl_orte, r.einsatz1_auftrag);
    });
    return out;
  });

  constructor() {
    // hover from the stint chart: emphasise this person's bars (no re-render, so the zoom stays where it is)
    effect(() => {
      const ch = this.chart();
      const h = this.store.hover();
      if (!ch || ch.isDisposed()) return;
      ch.dispatchAction({ type: 'downplay', seriesIndex: 0 });
      if (!h) return;
      const idx = this.bars().map((b, i) => (b.person === h ? i : -1)).filter((i) => i >= 0);
      if (idx.length) ch.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: idx });
    });
  }

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.rows();
    const bars = this.bars();
    const t = this.theme.tokens();
    const c = this.c();
    if (!rows.length) return null;
    const now = today();
    const lo = Math.min(...bars.map((b) => b.von), now) - 20 * DAY;
    const hi = Math.max(...bars.map((b) => b.bis), now) + 20 * DAY;
    const store = this.store;
    const labels = rows.map((r) => `${activeByHiddenStint(r, now) ? '◆' : STATUS_GLYPH[r.status_code]} ${store.personLabel(r)}`);
    const many = rows.length > LANES_VISIBLE;
    return {
      animation: false,
      aria: ariaDecal(),
      grid: { left: 8, right: many ? 34 : 16, top: 28, bottom: 52, outerBounds: { left: 8, right: many ? 34 : 16, top: 28, bottom: 52 } },
      tooltip: {
        confine: true,
        formatter: (p: { seriesType: string; dataIndex: number }) => {
          if (p.seriesType !== 'custom') return '';
          const b = bars[p.dataIndex];
          const r = rows[b.lane];
          const days = Math.round((b.bis - DAY - b.von) / DAY);
          let html = ttHead(`${store.personLabel(r)} · Einsatz ${b.stint === 1 ? '1 (letzter)' : '2 (vorletzter)'}`);
          html += ttRow(b.ga ? c.ga[b.ga] : null, 'Geschäftsart', b.ga ?? '–');
          html += ttRow(null, 'von – bis', `${dateOnly(b.von)} – ${dateOnly(b.bis - DAY)}`);
          html += ttRow(null, 'Dauer', `${num(days)} Tage`);
          html += ttRow(null, 'Ort (erste Tour)', `${b.ort ?? '–'}${(b.orte ?? 0) > 1 ? ` (+${num((b.orte ?? 1) - 1)} weitere)` : ''}`);
          html += ttRow(null, 'Auftrag', b.auftrag ?? '–');
          html += ttRow(null, 'Status', `${STATUS_GLYPH[r.status_code]} ${r.status ?? r.status_code}`);
          if (b.austritt != null) html += ttRow(null, 'Austritt (Vertragsende)', dateOnly(b.austritt));
          if (activeByHiddenStint(r, now)) html += `<div style="margin-top:4px">◆ aktiv durch einen Einsatz, der nicht unter den letzten zwei ist</div>`;
          return html + '<div style="opacity:.7;margin-top:4px">Klicken: Person öffnen</div>';
        },
      },
      xAxis: {
        type: 'time', min: lo, max: hi, position: 'top',
        axisLabel: { color: t.muted, hideOverlap: true, formatter: { month: '{MMM} {yy}', year: '{yyyy}', day: '{d}.{M}.' } },
        splitLine: { show: true, lineStyle: { color: t.grid } },
      },
      yAxis: {
        type: 'category', data: labels, inverse: true,
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { interval: 0, width: 150, overflow: 'truncate', color: t.ink2, fontSize: 12, fontFamily: 'Bahnschrift, "Segoe UI", sans-serif' },
        splitLine: { show: true, lineStyle: { color: t.grid } },
      },
      dataZoom: [
        { type: 'slider', xAxisIndex: 0, bottom: 8, height: 18, labelFormatter: (v: number) => dateShort(v), brushSelect: false },
        { type: 'inside', xAxisIndex: 0, zoomOnMouseWheel: 'shift', moveOnMouseWheel: false, moveOnMouseMove: true },
        ...(many ? [
          { type: 'slider', yAxisIndex: 0, right: 6, width: 14, startValue: 0, endValue: LANES_VISIBLE - 1, showDetail: false, zoomLock: true, brushSelect: false },
          // the wheel scrolls the page, never the lanes (no scroll trap over the hero chart); drag moves them
          { type: 'inside', yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: false, moveOnMouseMove: true },
        ] : []),
      ],
      series: [{
        type: 'custom',
        id: 'stints',
        clip: true,
        data: bars.map((b) => [b.von, b.lane, b.bis]),
        encode: { x: [0, 2], y: 1 },
        renderItem: (params: any, api: any) => {
          const b = bars[params.dataIndex];
          const p0 = api.coord([b.von, b.lane]);
          const p1 = api.coord([b.bis, b.lane]);
          const band = api.size([0, 1])[1];
          const h = Math.max(4, band * 0.56);
          const y = p0[1] - h / 2;
          const w = Math.max(3, p1[0] - p0[0]);
          const fill = b.ga ? c.ga[b.ga] : t.neutral;
          const children: any[] = [{
            type: 'rect',
            shape: { x: p0[0], y, width: w, height: h, r: Math.min(4, h / 2) },
            style: { fill, opacity: b.stint === 2 ? c.older : 1, stroke: t.surface, lineWidth: 1 },
            emphasis: { style: { stroke: t.ink, lineWidth: 2, opacity: 1 } },
          }];
          if (b.stint === 1 && b.austritt != null) {
            const ax = api.coord([b.austritt + DAY, b.lane])[0];
            children.push({ type: 'rect', shape: { x: ax - 1, y: y - 3, width: 2.5, height: h + 6 }, style: { fill: c.austritt }, silent: true });
          }
          return { type: 'group', children };
        },
        markLine: {
          symbol: 'none', silent: true, animation: false,
          lineStyle: { color: c.today, width: 1.5, type: 'solid' },
          label: { formatter: () => 'heute', color: t.ink, position: 'end', fontSize: 11 },
          data: [{ xAxis: now }],
        },
      }],
    };
  });

  protected click(e: { seriesType?: string; dataIndex?: number }): void {
    if (e.seriesType !== 'custom' || e.dataIndex == null) return;
    const b = this.bars()[e.dataIndex];
    if (!b) return;
    this.chart()?.dispatchAction({ type: 'hideTip' });          // the tooltip would sit above the drawer
    this.store.openDrawer(b.person);
  }
  protected over(e: { seriesType?: string; dataIndex?: number }): void {
    if (e.seriesType !== 'custom' || e.dataIndex == null) return;
    const b = this.bars()[e.dataIndex];
    if (b && this.store.hover() !== b.person) this.store.hover.set(b.person);
  }
}
