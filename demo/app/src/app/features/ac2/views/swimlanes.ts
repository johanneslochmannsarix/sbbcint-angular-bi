import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { UiButton } from '../../../shared/ui';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { DataStore, Person, label } from '../data/model';
import { SelectionService } from '../data/selection';
import { ThemeService } from '../data/theme';
import { addMonths, dateOnly, monthShort, num, today } from '../../../core/format';
import { HELD, StatusCode } from '../data/tokens';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { esc, ttHead, ttRow } from '../../../shared/chart-opts';

const LANE = 18;
const PAST_MONTHS = 36;
const FUTURE_MONTHS = 36;

interface Bar { lane: number; from: number; to: number; status: StatusCode; openFrom: boolean; openTo: boolean; person: Person; qual: string }

/**
 * View 3 (no report equivalent). Overview: one lane per qualification, every held validity window drawn
 * translucent, so overlaps build density and the ends show the renewal waves. Focus (click a lane, or a
 * treemap leaf): one lane per holder of that qualification, sorted by «Gültig bis».
 */
@Component({
  selector: 'app-swimlanes',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card [heading]="focusName() ? 'Gültigkeit: ' + focusName() : 'Gültigkeitsfenster je Qualifikation'" [sub]="sub()" [q]="store.modelQueries"
      [forceEmpty]="!!store.model() && bars().length === 0" emptyNote="Keine datierte Qualifikation unter diesem Filter.">
      <div card-tools class="tools">
        @if (focusName()) {
          <ui-button (click)="sel.qualification.set(null)">Alle Qualifikationen</ui-button>
        }
      </div>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"></div>
      <p class="chart-note">Zeitachse {{ PAST_MONTHS / 12 }} Jahre zurück bis {{ FUTURE_MONTHS / 12 }} Jahre voraus; Linie = heute. Fenster ohne Beginn oder ohne Ende laufen bis an den Rand (blasser Teil).
        @if (undated()) { {{ num(undated()) }} gehaltene Qualifikationen ohne jedes Datum sind hier nicht darstellbar. }</p>
    </app-card>
  `,
  styles: [`.tools { display: flex; gap: 8px; }`],
})
export class SwimlanesView {
  protected readonly store = inject(DataStore);
  protected readonly sel = inject(SelectionService);
  protected readonly theme = inject(ThemeService);
  protected readonly num = num;
  protected readonly PAST_MONTHS = PAST_MONTHS;
  protected readonly FUTURE_MONTHS = FUTURE_MONTHS;

  private readonly span = computed(() => {
    const t0 = today();
    return { min: addMonths(t0, -PAST_MONTHS), max: addMonths(t0, FUTURE_MONTHS), now: t0 };
  });

  protected readonly focusName = computed(() => {
    const q = this.sel.qualification();
    return q ? (this.store.model()?.qualBySk.get(q)?.name ?? null) : null;
  });

  private readonly layout = computed(() => {
    const m = this.store.model();
    if (!m) return { lanes: [] as string[], laneKeys: [] as string[], bars: [] as Bar[], undated: 0 };
    const { min, max } = this.span();
    const focus = this.sel.qualification();
    const masked = this.store.masked();
    const bars: Bar[] = [];
    let undated = 0;
    const push = (lane: number, p: Person, qsk: string) => {
      const c = p.cells.get(qsk);
      if (!c) return;
      if (c.from == null && c.to == null) { undated++; return; }
      const from = c.from ?? min;
      const to = c.to ?? max;
      if (to < min || from > max) return;
      bars.push({ lane, from: Math.max(from, min), to: Math.min(to, max), status: c.status, openFrom: c.from == null, openTo: c.to == null, person: p, qual: m.qualBySk.get(qsk)!.name });
    };
    if (focus) {
      const holders = this.sel.people().filter((p) => p.cells.has(focus))
        .sort((a, b) => (a.cells.get(focus)!.to ?? Infinity) - (b.cells.get(focus)!.to ?? Infinity) || a.key.localeCompare(b.key));
      holders.forEach((p, i) => push(i, p, focus));
      return { lanes: holders.map((p) => label(p, masked)), laneKeys: holders.map((p) => p.key), bars, undated };
    }
    const used = m.quals.filter((q) => this.sel.people().some((p) => p.cells.has(q.sk)));
    used.forEach((q, i) => { for (const p of this.sel.people()) push(i, p, q.sk); });
    return { lanes: used.map((q) => q.name), laneKeys: used.map((q) => q.sk), bars, undated };
  });
  protected readonly bars = computed(() => this.layout().bars);
  protected readonly undated = computed(() => this.layout().undated);

  protected readonly height = computed(() => Math.min(720, Math.max(200, this.layout().lanes.length * LANE + 70)));
  private readonly scroll = computed(() => this.layout().lanes.length * LANE + 70 > 720);

  protected readonly sub = computed(() => {
    const l = this.layout();
    const who = this.sel.active() ? `ausgewählte Personen (${this.sel.brushLabel()})` : 'alle Personen';
    return this.focusName()
      ? `${num(l.lanes.length)} Inhaber, nach «Gültig bis» sortiert; ${who}. Klick auf einen Balken öffnet die Person.`
      : `${num(l.bars.length)} Gültigkeitsfenster in ${l.lanes.length} Qualifikationen; ${who}. Klick auf eine Bahn zeigt deren Inhaber.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    if (!this.store.model()) return null;
    const t = this.theme.tokens();
    const { min, max, now } = this.span();
    const { lanes, bars } = this.layout();
    const focus = !!this.sel.qualification();
    const statusLabel = this.store.statusLabel();
    const alpha = focus ? 0.9 : 0.06;
    const data = bars.map((b) => [b.lane, b.from, b.to, HELD.indexOf(b.status), b.openFrom ? 1 : 0, b.openTo ? 1 : 0]);
    const visibleEnd = this.scroll() ? Math.min(100, (650 / LANE / Math.max(1, lanes.length)) * 100) : 100;
    return {
      animation: false,
      grid: { left: 210, right: 24, top: 28, bottom: 28, outerBoundsMode: 'none' },
      xAxis: { type: 'time', min, max, position: 'top', axisLabel: { formatter: (v: number) => monthShort(v), hideOverlap: true }, splitLine: { show: true } },
      yAxis: {
        type: 'category', inverse: true, data: lanes, axisLine: { show: false },
        axisLabel: { width: 196, overflow: 'truncate', fontSize: 11, color: t.ink2, interval: 0 },
        splitLine: { show: true, lineStyle: { color: t.grid } },
      },
      dataZoom: this.scroll()
        ? [{ type: 'slider', yAxisIndex: 0, right: 4, width: 12, start: 0, end: visibleEnd, showDetail: false, brushSelect: false },
           { type: 'inside', yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: true, moveOnMouseMove: false }]
        : [],
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const b = bars[p.dataIndex];
          if (!b) return '';
          return ttHead(label(b.person, this.store.masked())) + `<div style="margin-bottom:4px">${esc(b.qual)}</div>`
            + ttRow(t.status[b.status], statusLabel[b.status], '')
            + ttRow(null, 'Gültig von', b.openFrom ? 'offen' : dateOnly(b.from))
            + ttRow(null, 'Gültig bis', b.openTo ? 'offen' : dateOnly(b.to));
        },
      },
      series: [
        {
          type: 'custom', data, clip: true,
          encode: { x: [1, 2], y: 0 },
          renderItem: (params: { coordSys: { x: number; y: number; width: number; height: number } }, api: {
            value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[];
          }) => {
            const lane = api.value(0);
            const a = api.coord([api.value(1), lane]);
            const b = api.coord([api.value(2), lane]);
            const h = Math.max(3, api.size([0, 1])[1] * (focus ? 0.55 : 0.6));
            const cs = params.coordSys;
            const x0 = Math.max(a[0], cs.x);
            const x1 = Math.min(b[0], cs.x + cs.width);
            if (x1 <= x0 || a[1] < cs.y - h || a[1] > cs.y + cs.height + h) return null;
            const color = t.status[HELD[api.value(3)]];
            const openFrom = api.value(4) === 1;
            const openTo = api.value(5) === 1;
            const children: unknown[] = [{
              type: 'rect', shape: { x: x0, y: a[1] - h / 2, width: Math.max(1, x1 - x0), height: h, r: focus ? 2 : 0 },
              style: { fill: color, opacity: openFrom || openTo ? alpha * 0.45 : alpha },
            }];
            if (!openTo && b[0] <= cs.x + cs.width) {
              // the renewal date: a firm tick at the end of the window
              children.push({ type: 'rect', shape: { x: b[0] - 1, y: a[1] - h / 2 - 1, width: 2, height: h + 2 }, style: { fill: color, opacity: focus ? 1 : 0.7 } });
            }
            return { type: 'group', children };
          },
        },
        {
          type: 'line', data: [], silent: true,
          markLine: { symbol: 'none', silent: true, label: { formatter: 'heute', color: t.ink2, position: 'start' }, lineStyle: { color: t.ink, width: 1, type: 'solid' }, data: [{ xAxis: now }] },
        },
      ],
    };
  });

  protected click(e: { seriesType?: string; dataIndex?: number; componentType?: string; value?: unknown }): void {
    const b = e.seriesType === 'custom' && e.dataIndex != null ? this.bars()[e.dataIndex] : undefined;
    if (!b) return;
    if (this.sel.qualification()) this.sel.person.set(b.person.key);
    else this.sel.qualification.set(this.layout().laneKeys[b.lane]);
  }
}
