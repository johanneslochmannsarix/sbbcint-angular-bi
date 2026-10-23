import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { DataStore, Person, label } from '../data/model';
import { SelectionService } from '../data/selection';
import { ThemeService } from '../data/theme';
import { HELD, StatusCode } from '../data/tokens';
import { dateOnly, num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { esc, ttHead, ttRow } from '../../../shared/chart-opts';

const GROUP = 'ac2-matrix';
const LEFT = 206;      // y slider + person labels; identical in the heatmap and the column strip
const RIGHT = 8;
const TOP = 6;
const BOTTOM = 34;     // x slider
const ROWS_VISIBLE = 46;
type Sort = 'gaps_desc' | 'gaps_asc';

/**
 * View 1 (replaces «Qualifikationsmatrix» + «Wer hat eine Qualifikation noch nicht?»).
 * Only held cells are data points; "Fehlt" is the grid background (the fact is the full cross product,
 * README §2), so 69k cells cost ~3k marks. Three instances share one echarts.connect group: the column
 * strip follows the x zoom (dataZoom id dzx), the gap bars follow the y zoom (dzy / dzyi).
 */
@Component({
  selector: 'app-heatmap',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wer hat welche Qualifikation" [sub]="sub()" [q]="store.modelQueries" [forceEmpty]="!!store.model() && !store.model()!.persons.length">
      <div card-tools class="tools">
        <div class="seg seg-sm" role="group" aria-label="Sortierung der Zeilen">
          <button type="button" [attr.aria-pressed]="sort() === 'gaps_desc'" (click)="sort.set('gaps_desc')">Meiste Lücken oben</button>
          <button type="button" [attr.aria-pressed]="sort() === 'gaps_asc'" (click)="sort.set('gaps_asc')">Wenigste oben</button>
        </div>
        <button type="button" class="btn" [class.is-on]="brushing()" (click)="startBrush()" title="Ziehen Sie über die Zeilen, um eine Gruppe von Personen auszuwählen">Zeilen auswählen</button>
        @if (sel.active()) {
          <button type="button" class="btn btn-ghost" (click)="clearBrush()">Auswahl aufheben</button>
        }
      </div>
      <div class="legend-row" role="group" aria-label="Status ein- und ausblenden">
        @for (s of legend(); track s.code) {
          <button type="button" class="chip" [attr.aria-pressed]="!hidden().has(s.code)" (click)="toggle(s.code)" [disabled]="s.code === 'MISSING_NEVER'"
            [title]="s.code === 'MISSING_NEVER' ? 'Fehlt ist der Hintergrund der Matrix' : 'Status ein- oder ausblenden'">
            <i class="swatch" [class.ring]="s.code === 'DATES_MISSING'" [style.background]="s.color" [style.border-color]="s.code === 'DATES_MISSING' ? tokens().ring : s.color"></i>
            {{ s.label }} <span class="chip-n">{{ s.n }}</span>
          </button>
        }
      </div>
      <div class="matrix">
        <div echarts class="m-top" [options]="topOptions()!" [theme]="theme.echartsTheme()" (chartInit)="join($event)"></div>
        <p class="m-corner">Balken: gehaltene Qualifikationen{{ sel.active() ? ' in der Auswahl' : '' }}</p>
        <div echarts class="m-main" [options]="mainOptions()!" [theme]="theme.echartsTheme()" (chartInit)="initMain($event)" (chartClick)="onCellClick($any($event))"></div>
        <div echarts class="m-side" [options]="sideOptions()!" [theme]="theme.echartsTheme()" (chartInit)="join($event)" (chartClick)="onSideClick($any($event))"></div>
      </div>
      <p class="chart-note">Eine Zeile je Person, eine Spalte je Qualifikation. Leere Felder: nie erfasst («Fehlt»). Ringe: Zuordnung ohne Datumsangabe.
        @if (model()?.noName) { {{ num(model()!.noName) }} Personen haben im Export keinen Namen (QDASH-8) und erscheinen als «ohne Namen». }
        @if (model()?.duplicatePairs) { {{ model()!.duplicatePairs }} Paare stehen doppelt im Modell (Alias-Zeilen, gewollt); das Feld zeigt den besseren Status. }
        Mausrad scrollt die Zeilen, ein Klick öffnet die Person.</p>
    </app-card>
  `,
  styles: [`
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .btn.is-on { border-color: var(--accent); background: var(--accent-wash); }
    .legend-row { display: flex; gap: 6px; flex-wrap: wrap; margin: 2px 0 8px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--rule); background: var(--surface); border-radius: 999px; padding: 2px 10px; font-size: 12.5px; cursor: pointer; color: var(--ink); }
    .chip[aria-pressed="false"] { color: var(--muted); text-decoration: line-through; }
    .chip[aria-pressed="false"] .swatch { opacity: .25; }
    .chip:disabled { cursor: default; }
    .chip-n { color: var(--muted); font-variant-numeric: tabular-nums; }
    .swatch { width: 12px; height: 12px; border-radius: 3px; border: 1.5px solid transparent; display: inline-block; }
    .matrix { display: grid; grid-template-columns: minmax(0, 1fr) 150px; grid-template-rows: 150px 640px; }
    .m-top { grid-column: 1; grid-row: 1; }
    .m-corner { grid-column: 2; grid-row: 1; align-self: end; margin: 0 0 6px 8px; font-size: 12px; color: var(--muted); }
    .m-main { grid-column: 1; grid-row: 2; }
    .m-side { grid-column: 2; grid-row: 2; }
    @media (max-width: 760px) { .matrix { grid-template-columns: minmax(0, 1fr) 90px; grid-template-rows: 130px 520px; } }
  `],
})
export class HeatmapView {
  protected readonly store = inject(DataStore);
  protected readonly sel = inject(SelectionService);
  protected readonly theme = inject(ThemeService);
  protected readonly num = num;
  protected readonly tokens = this.theme.tokens;
  protected readonly model = this.store.model;

  protected readonly sort = signal<Sort>('gaps_asc');
  protected readonly hidden = signal<ReadonlySet<StatusCode>>(new Set());
  protected readonly brushing = signal(false);
  private main: ECharts | null = null;
  /** last zoom windows (plain fields: reading them must not re-render the charts on every scroll) */
  private zx: [number, number] = [0, 100];
  private zy: [number, number] | null = null;
  private readonly charts: ECharts[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.charts.splice(0));
    // another dataset: start at the top-left again
    effect(() => {
      this.store.tenant();
      this.store.env();
      this.zx = [0, 100];
      this.zy = null;
      untracked(() => this.brushing.set(false));
    });
  }

  protected readonly rows = computed<Person[]>(() => {
    const m = this.model();
    if (!m) return [];
    const dir = this.sort() === 'gaps_desc' ? -1 : 1;
    return [...m.persons].sort((a, b) => dir * (a.gaps - b.gaps) || dir * (a.expired - b.expired) || a.key.localeCompare(b.key));
  });

  protected readonly sub = computed(() => {
    const m = this.model();
    if (!m) return '';
    return `${num(m.persons.length)} Personen × ${m.quals.length} Qualifikationen, Zeilen nach Anzahl fehlender Qualifikationen sortiert (${this.sort() === 'gaps_asc' ? 'wenigste' : 'meiste'} oben)`;
  });

  protected readonly legend = computed(() => {
    const m = this.model();
    const t = this.tokens();
    const labels = this.store.statusLabel();
    const counts = new Map<StatusCode, number>();
    let held = 0;
    for (const p of m?.persons ?? []) for (const c of p.cells.values()) { counts.set(c.status, (counts.get(c.status) ?? 0) + 1); held++; }
    const missing = m ? m.persons.length * m.quals.length - held : 0;
    return [...HELD, 'MISSING_NEVER' as StatusCode]
      .map((code) => ({ code, label: labels[code], color: t.status[code], n: num(code === 'MISSING_NEVER' ? missing : counts.get(code) ?? 0) }));
  });

  protected toggle(code: StatusCode): void {
    const next = new Set(this.hidden());
    if (next.has(code)) next.delete(code);
    else next.add(code);
    this.hidden.set(next);
  }

  private yLabels = computed(() => {
    const masked = this.store.masked();
    return this.rows().map((p) => label(p, masked));
  });

  private yWin(n: number): [number, number] {
    return this.zy ?? [0, n <= ROWS_VISIBLE ? 100 : Math.max(1, (ROWS_VISIBLE / n) * 100)];
  }

  protected readonly mainOptions = computed<EChartsCoreOption | null>(() => {
    const m = this.model();
    if (!m) return null;
    const t = this.tokens();
    const rows = this.rows();
    const labels = this.yLabels();
    const hidden = this.hidden();
    const statusLabel = this.store.statusLabel();
    const data: unknown[] = [];
    rows.forEach((p, y) => {
      for (const [qsk, c] of p.cells) {
        const q = m.qualBySk.get(qsk)!;
        const v = HELD.indexOf(c.status);
        data.push(c.status === 'DATES_MISSING'
          ? { value: [q.index, y, v], itemStyle: { borderColor: t.ring, borderWidth: 1.5 } }
          : [q.index, y, v]);
      }
    });
    const selected: Record<string, boolean> = {};
    HELD.forEach((s, i) => (selected[i] = !hidden.has(s)));
    return {
      animation: false,
      grid: { left: LEFT, right: RIGHT, top: TOP, bottom: BOTTOM, show: true, backgroundColor: t.status.MISSING_NEVER, borderWidth: 0, outerBoundsMode: 'none' },
      xAxis: { type: 'category', data: m.quals.map((q) => q.name), axisLabel: { show: false }, axisLine: { show: false }, splitArea: { show: false } },
      yAxis: {
        type: 'category', inverse: true, data: labels, axisLine: { show: false },
        axisLabel: { width: LEFT - 34, overflow: 'truncate', fontSize: 11, color: t.ink2, interval: 0 },
      },
      dataZoom: [
        { id: 'dzx', type: 'slider', xAxisIndex: 0, start: this.zx[0], end: this.zx[1], height: 14, bottom: 6, left: LEFT, right: RIGHT, showDetail: false, filterMode: 'empty', brushSelect: false },
        { id: 'dzy', type: 'slider', yAxisIndex: 0, width: 14, left: 4, top: TOP, bottom: BOTTOM, start: this.yWin(rows.length)[0], end: this.yWin(rows.length)[1], showDetail: false, filterMode: 'empty', brushSelect: false },
        { id: 'dzyi', type: 'inside', yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: true, moveOnMouseMove: false, filterMode: 'empty' },
      ],
      visualMap: {
        type: 'piecewise', show: false, dimension: 2, seriesIndex: 0,
        pieces: HELD.map((s, i) => ({ value: i, label: statusLabel[s], color: t.status[s] })),
        selected,
      },
      brush: {
        yAxisIndex: 0, brushType: 'lineY', brushMode: 'single', transformable: true, throttleType: 'debounce', throttleDelay: 250,
        brushStyle: { borderWidth: 1, color: 'rgba(42,120,214,0.10)', borderColor: t.ink2 },
        outOfBrush: { colorAlpha: 0.25 },
      },
      toolbox: { show: false },
      tooltip: {
        trigger: 'item',
        formatter: (pr: { value?: number[]; data?: { value: number[] } }) => {
          const v = (pr.data && !Array.isArray(pr.data) ? pr.data.value : pr.value) as number[];
          const p = rows[v[1]];
          const q = m.quals[v[0]];
          const c = p?.cells.get(q.sk);
          if (!p || !c) return '';
          const st = HELD[v[2]];
          return ttHead(labels[v[1]]) + `<div style="margin-bottom:4px">${esc(q.name)}</div>`
            + ttRow(t.status[st], statusLabel[st], '')
            + ttRow(null, 'Gültig von', dateOnly(c.from)) + ttRow(null, 'Gültig bis', dateOnly(c.to))
            + (p.org ? ttRow(null, 'Mandant', p.org) : '');
        },
      },
      series: [{
        type: 'heatmap', data, progressive: 0,
        itemStyle: { borderColor: t.surface, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } },
      }],
    };
  });

  /** Column strip: held qualifications per column, stacked by status, over the current selection. */
  protected readonly topOptions = computed<EChartsCoreOption | null>(() => {
    const m = this.model();
    if (!m) return null;
    const t = this.tokens();
    const people = this.sel.people();
    const hidden = this.hidden();
    const statusLabel = this.store.statusLabel();
    const counts = HELD.map(() => new Array(m.quals.length).fill(0));
    for (const p of people) for (const [qsk, c] of p.cells) counts[HELD.indexOf(c.status)][m.qualBySk.get(qsk)!.index]++;
    return {
      animation: false,
      grid: { left: LEFT, right: RIGHT, top: 106, bottom: 2, outerBoundsMode: 'none' },
      xAxis: {
        type: 'category', position: 'top', data: m.quals.map((q) => q.name), axisLine: { show: false },
        axisLabel: { rotate: 60, width: 118, overflow: 'truncate', fontSize: 10.5, color: t.ink2, interval: 0 },
      },
      yAxis: { type: 'value', show: false },
      dataZoom: [{ id: 'dzx', type: 'inside', xAxisIndex: 0, disabled: true, start: this.zx[0], end: this.zx[1], filterMode: 'empty' }],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { dataIndex: number; seriesName: string; value: number; color: string }[]) =>
          ttHead(m.quals[ps[0].dataIndex].name) + ps.filter((p) => p.value).map((p) => ttRow(p.color, p.seriesName, num(p.value))).join('')
          + ttRow(null, 'Personen ohne', num(people.length - ps.reduce((a, p) => a + (p.value || 0), 0))) },
      series: HELD.map((s, i) => ({
        name: statusLabel[s], type: 'bar', stack: 'held', barMaxWidth: 18, data: hidden.has(s) ? counts[i].map(() => 0) : counts[i],
        itemStyle: s === 'DATES_MISSING' ? { color: t.status[s], borderColor: t.ring, borderWidth: 1 } : { color: t.status[s] },
      })),
    };
  });

  /** Gap bars per row; follows the y zoom through the connect group (ids dzy / dzyi). */
  protected readonly sideOptions = computed<EChartsCoreOption | null>(() => {
    const m = this.model();
    if (!m) return null;
    const t = this.tokens();
    const rows = this.rows();
    const labels = this.yLabels();
    const brushed = this.sel.brushed();
    return {
      animation: false,
      grid: { left: 8, right: 26, top: TOP, bottom: BOTTOM, outerBoundsMode: 'none' },
      xAxis: { type: 'value', max: m.quals.length, splitNumber: 2, axisLabel: { fontSize: 10 }, splitLine: { show: true } },
      yAxis: { type: 'category', inverse: true, data: labels, show: false },
      dataZoom: [
        { id: 'dzy', type: 'slider', yAxisIndex: 0, show: false, start: this.yWin(rows.length)[0], end: this.yWin(rows.length)[1], filterMode: 'empty' },
        { id: 'dzyi', type: 'inside', yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: true, moveOnMouseMove: false, filterMode: 'empty' },
      ],
      tooltip: { trigger: 'item', formatter: (p: { dataIndex: number }) =>
        ttHead(labels[p.dataIndex]) + ttRow(null, 'Fehlende Qualifikationen', num(rows[p.dataIndex].gaps))
        + ttRow(null, 'Abgelaufen', num(rows[p.dataIndex].expired)) },
      series: [{
        type: 'bar', barMaxWidth: 10, barCategoryGap: '25%',
        data: rows.map((p) => ({
          value: p.gaps,
          itemStyle: { color: t.ink2, opacity: brushed && !brushed.has(p.key) ? 0.25 : 0.75, borderRadius: [0, 3, 3, 0] },
        })),
      }],
    };
  });

  protected join(chart: ECharts): void {
    this.charts.push(chart);
    chart.group = GROUP;
    void import('../../../core/echarts-setup').then((e) => e.connect(GROUP));
  }

  protected initMain(chart: ECharts): void {
    this.main = chart;
    this.join(chart);
    chart.on('brushEnd', (e: unknown) => this.onBrush(e as { areas?: { coordRange?: number[] }[] }));
    chart.on('datazoom', () => {
      const dz = (chart.getOption() as { dataZoom?: { id?: string; start?: number; end?: number }[] }).dataZoom ?? [];
      const x = dz.find((d) => d.id === 'dzx');
      const y = dz.find((d) => d.id === 'dzy');
      if (x?.start != null && x.end != null) this.zx = [x.start, x.end];
      if (y?.start != null && y.end != null) this.zy = [y.start, y.end];
    });
  }

  protected startBrush(): void {
    if (!this.main) return;
    this.brushing.set(true);
    this.main.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineY', brushMode: 'single' } });
  }

  private onBrush(e: { areas?: { coordRange?: number[] }[] }): void {
    const r = e.areas?.[0]?.coordRange;
    const rows = this.rows();
    if (!r || r.length < 2) {
      this.sel.clear();
      return;
    }
    const a = Math.max(0, Math.min(r[0], r[1]));
    const b = Math.min(rows.length - 1, Math.max(r[0], r[1]));
    const picked = rows.slice(a, b + 1).map((p) => p.key);
    this.sel.setBrush(picked, `Zeilen ${num(a + 1)}–${num(b + 1)}`);
    this.brushing.set(false);
    this.main?.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: false } });
  }

  protected clearBrush(): void {
    this.main?.dispatchAction({ type: 'brush', areas: [] });
    this.main?.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: false } });
    this.brushing.set(false);
    this.sel.clear();
  }

  protected onCellClick(e: { value?: number[]; data?: { value: number[] } }): void {
    const v = (e.data && !Array.isArray(e.data) ? e.data.value : e.value) as number[] | undefined;
    const p = v ? this.rows()[v[1]] : undefined;
    if (p) this.sel.person.set(p.key);
  }

  protected onSideClick(e: { dataIndex?: number }): void {
    const p = e.dataIndex != null ? this.rows()[e.dataIndex] : undefined;
    if (p) this.sel.person.set(p.key);
  }
}
