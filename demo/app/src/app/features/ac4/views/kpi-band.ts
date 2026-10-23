import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartGroup } from '../../../shared/connect';
import { ChartResize } from '../../../shared/chart-resize';
import { ttHead, ttRow } from '../../../shared/chart-opts';
import { ac4Colors } from '../data/palette';
import { Ac4Store, FOCUS_LABEL, Focus, monthLabel } from '../data/store';
import { MonatRow } from '../data/types';

interface TileDef {
  key: string;
  label: string;
  focus: Focus | null;
  value: (r: MonatRow) => number | null;
  show: (v: number | null) => string;
  note: (r: MonatRow) => string;
  color: 'plan' | 'fahren' | 'ist' | 'neutral';
  /** a coverage tile: the value is a fill rate, not volume */
  coverage?: boolean;
}

const fill = (r: MonatRow) => (r.touren ? (r.touren_anger ?? 0) / r.touren : null);
const signedPct = (v: number | null) => (v == null || !Number.isFinite(v) ? BLANK : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v) * 100, 1)} %`);

const TILES: TileDef[] = [
  { key: 'touren', label: 'Touren', focus: null, value: (r) => r.touren, show: (v) => num(v), color: 'plan',
    note: (r) => `${num(r.tourelemente)} Tourelemente` },
  { key: 'plandauer', label: 'Plandauer der Touren', focus: 'plandauer_touren_h', value: (r) => r.plandauer_touren_h, show: (v) => hours(v, 0), color: 'plan',
    note: (r) => `Ø ${hours(r.dauer_je_tour_h, 2)} je Tour` },
  { key: 'fahranteil', label: 'Fahranteil (Plan)', focus: 'fahranteil', value: (r) => r.fahranteil, show: (v) => pct(v, 1), color: 'fahren',
    note: (r) => `${hours(r.fahren_h, 0)} Fahren von ${hours(r.plandauer_h, 0)}` },
  { key: 'ist', label: 'Ist-Erfassungsgrad vergangener Elemente', focus: 'ist_erfassung', value: (r) => r.ist_erfassung, show: (v) => pct(v, 1), color: 'ist', coverage: true,
    note: (r) => `${num(r.elemente_mit_ist)} Elemente mit Ist · Tour-Ist abgeleitet bei ${num(r.touren_ist)} Touren` },
  { key: 'istplan', label: 'Ist gegenüber Plan', focus: null, value: (r) => r.ist_zu_plan, show: signedPct, color: 'ist',
    note: (r) => `nur Elemente mit Ist · Beginn im Median ${r.median_beginn == null ? BLANK : (r.median_beginn > 0 ? '+' : '') + num(r.median_beginn)} min` },
  { key: 'personen', label: 'Personen eingeteilt', focus: 'anteil_person', value: (r) => r.personen, show: (v) => num(v), color: 'plan',
    note: (r) => `${pct(r.anteil_person)} der Elemente · SBB Cargo Deutschland ohne Personen im Export` },
  { key: 'anger', label: 'Touren mit angerechneter Zeit', focus: 'anger_fill', value: fill, show: (v) => pct(v, 1), color: 'plan', coverage: true,
    note: (r) => `${num(r.touren_anger)} von ${num(r.touren)} Touren · ${hours(r.anger_h, 0)}` },
];

/**
 * View 0 - the KPI band: one tile per report KPI for the selected Planmonat (or the whole window), a column
 * sparkline of the same measure per month underneath. Clicking a month column picks that month for every view
 * (sparklines share one echarts.connect group). Clicking a tile with a focus makes it the measure the
 * Produktivität treemap colours by. Coverage tiles (Ist, angerechnete Zeit) say so in their label.
 */
@Component({
  selector: 'ac4-kpi-band',
  imports: [NgxEchartsDirective, ChartGroup, ChartResize],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ac4-band', role: 'group', 'aria-label': 'Kennzahlen je Planmonat' },
  styles: [`
    :host {
      display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));
      background: var(--surface); border: 1px solid var(--rule); border-top: 3px solid var(--ac4-ledger); border-radius: var(--r-card);
    }
    .ac4-tile { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--rule); }
    .ac4-tile:last-child { border-right: 0; }
    .ac4-tile.is-coverage { background: var(--surface-2); }
    .ac4-tile-hit { all: unset; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px; padding: 12px 14px 4px; cursor: pointer; min-height: 118px; }
    .ac4-tile-hit:disabled { cursor: default; }
    .ac4-tile-hit:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .ac4-tile.is-focus .ac4-tile-label { color: var(--ink); text-decoration: underline 2px var(--ac4-ledger); text-underline-offset: 4px; }
    .ac4-tile-label { font-size: 12.5px; color: var(--ink-2); line-height: 1.25; min-height: 2.5em; }
    .ac4-tile-value { font-family: var(--ac4-num); font-size: 30px; line-height: 1.05; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ac4-tile-note { font-size: 11.5px; color: var(--muted); line-height: 1.3; }
    .ac4-spark { height: 52px; margin: 0 8px 4px; }
    @media (max-width: 1280px) { :host { grid-template-columns: repeat(4, minmax(0, 1fr)); } .ac4-tile { border-bottom: 1px solid var(--rule); } }
    @media (max-width: 640px) { :host { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `],
  template: `
    @for (t of tiles(); track t.key) {
      <div class="ac4-tile" [class.is-focus]="t.active" [class.is-coverage]="t.coverage">
        <button type="button" class="ac4-tile-hit" [disabled]="!t.focus" [attr.aria-pressed]="t.focus ? t.active : null"
                [title]="t.focus ? 'Als Farbe der Übersicht verwenden' : ''" (click)="pick(t.focus)">
          <span class="ac4-tile-label">{{ t.label }}</span>
          <span class="ac4-tile-value">{{ t.value }}</span>
          <span class="ac4-tile-note">{{ t.note }}</span>
        </button>
        <div echarts class="ac4-spark" [options]="t.spark" [theme]="theme.echartsTheme()" chartGroup="ac4-monate"
             (chartClick)="month($any($event))" [attr.aria-label]="t.label + ' je Planmonat; Monat anklicken wählt ihn'"></div>
      </div>
    }
  `,
})
export class KpiBand {
  protected readonly store = inject(Ac4Store);
  protected readonly theme = inject(ThemeService);

  private readonly months = computed(() => this.store.monate.rows().filter((r) => !r.ist_gesamt && r.planmonat));
  private readonly current = computed<MonatRow | null>(() => {
    const m = this.store.month();
    const rows = this.store.monate.rows();
    return (m ? rows.find((r) => r.planmonat === m) : rows.find((r) => r.ist_gesamt)) ?? null;
  });

  protected readonly tiles = computed(() => {
    const r = this.current();
    const t = this.theme.tokens();
    const c = ac4Colors(this.theme.mode());
    const months = this.months();
    const sel = this.store.month();
    const focus = this.store.focus();
    return TILES.map((d) => {
      const color = c[d.color];
      const data = months.map((m) => {
        const inc = this.store.incomplete(m.planmonat);
        const on = !sel || sel === m.planmonat;
        return {
          value: d.value(m), name: m.planmonat,
          itemStyle: { color, opacity: (on ? 1 : 0.32) * (inc ? 0.55 : 1), borderRadius: [2, 2, 0, 0] },
        };
      });
      const spark: EChartsCoreOption = {
        animationDuration: 300,
        grid: { left: 0, right: 0, top: 4, bottom: 14 },
        xAxis: {
          type: 'category', data: months.map((m) => m.planmonat), axisLine: { show: false },
          axisLabel: { color: t.muted, fontSize: 9.5, interval: 0, formatter: (v: string) => monthLabel(v).slice(0, 3) },
        },
        yAxis: { type: 'value', show: false, min: 0 },
        tooltip: {
          trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
          formatter: (ps: { name: string; value: number }[]) => {
            const p = ps[0];
            const inc = this.store.incomplete(p.name);
            return ttHead(monthLabel(p.name) + (inc ? ` (${inc})` : '')) + ttRow(color, d.label, d.show(p.value ?? null));
          },
        },
        series: [{ type: 'bar', data, barMaxWidth: 18, barCategoryGap: '28%', cursor: 'pointer' }],
      };
      return {
        key: d.key, label: d.label, coverage: !!d.coverage, focus: d.focus, active: d.focus != null && d.focus === focus,
        value: r ? d.show(d.value(r)) : BLANK, note: r ? d.note(r) : '', spark,
      };
    });
  });

  protected pick(f: Focus | null): void {
    if (f) this.store.focus.set(f);
  }

  protected month(e: { name?: string }): void {
    if (!e?.name) return;
    this.store.pickMonth(this.store.month() === e.name ? null : e.name);
  }

  protected readonly focusLabel = FOCUS_LABEL;
}
