import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { BLANK, dateShort, dayMs, num, pct } from '../../../core/format';
import { ChartGroup } from '../../../shared/connect';
import { ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac8Store } from '../data/store';
import { KpiKey, KpiRow } from '../data/types';
import { Ac8Colors, StandKey, ac8Colors } from '../data/palette';

interface TileDef {
  key: KpiKey;
  label: string;
  focus: StandKey | null;
  color: (c: Ac8Colors) => string | null;
  note?: (r: KpiRow) => string;
}

const TILES: TileDef[] = [
  { key: 'schichten', label: 'Geplante Schichten', focus: null, color: () => null,
    note: (r) => `${num(r.schichtstunden)} h für ${num(r.personen_mit_schicht)} Personen` },
  { key: 'kommuniziert', label: 'Kommuniziert', focus: 'kommuniziert', color: (c) => c.kommuniziert,
    note: (r) => `${pct(r.schichten ? (r.kommuniziert ?? 0) / r.schichten : null)} der geplanten` },
  { key: 'geaendert_nicht_kommuniziert', label: 'Geändert, nicht kommuniziert', focus: 'geändert, nicht kommuniziert', color: (c) => c.geaendert,
    note: (r) => `Dienstplan zeigt ${num(r.dp_vorheriger_stand)}× den vorherigen Stand` },
  { key: 'nie_kommuniziert', label: 'Nie kommuniziert', focus: 'nie kommuniziert', color: (c) => c.nie,
    note: () => 'besetzt, aber ohne kommunizierte Version' },
  { key: 'unbesetzt', label: 'Unbesetzt', focus: 'unbesetzt', color: (c) => c.unbesetzt,
    note: (r) => `${num(r.dp_person_entfernt)} davon «Person entfernt» im Dienstplan` },
  { key: 'dp_geloescht', label: 'Gelöscht, nicht nachweisbar', focus: 'gelöscht', color: (c) => c.geloescht,
    note: () => 'kommuniziert, dann gelöscht (Regel v3)' },
  { key: 'abgelehnt', label: 'Rückmeldungen abgelehnt', focus: null, color: () => null,
    note: (r) => `${num(r.veraltet)} Versionen «veraltet» (≠ Entfernung)` },
  { key: 'personen_abwesend', label: 'Personen abwesend', focus: null, color: () => null,
    note: (r) => `${num(r.abwesenheiten)} Abwesenheitsfenster, ohne Grund` },
];

/**
 * View 1 - the Stellwerk strip: one tile per _Kennzahlen figure for the window (or the story week), a
 * sparkline of the same measure per day underneath. Sparklines share an echarts.connect group, so hovering
 * one day shows that day in every tile. Clicking a state tile sets the focus every other view filters by.
 */
@Component({
  selector: 'ac8-kpi-strip',
  imports: [NgxEchartsDirective, ChartGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ac8-strip', role: 'group', 'aria-label': 'Kennzahlen' },
  template: `
    @for (t of tiles(); track t.key) {
      <button type="button" class="ac8-tile" [class.is-focus]="t.active" [class.is-static]="!t.focus"
              [attr.aria-pressed]="t.focus ? t.active : null" [disabled]="!t.focus" (click)="pick(t.focus)">
        <span class="ac8-tile-label">
          @if (t.color) { <i class="key" [style.background]="t.color"></i> }
          {{ t.label }}
        </span>
        <span class="ac8-tile-value">{{ t.value }}</span>
        <span class="ac8-tile-note">{{ t.note }}</span>
        <div echarts class="ac8-spark" [options]="t.spark" [theme]="theme.echartsTheme()" chartGroup="ac8-days"></div>
      </button>
    }
  `,
})
export class KpiStrip {
  protected readonly store = inject(Ac8Store);
  protected readonly theme = inject(ThemeService);

  private readonly current = computed<KpiRow | null>(() => {
    const w = this.store.storyWeek();
    if (w) return this.store.kpiWeek.rows().find((r) => r.von.startsWith(w.from)) ?? null;
    return this.store.kpiWin.rows()[0] ?? null;
  });

  protected readonly tiles = computed(() => {
    const r = this.current();
    const t = this.theme.tokens();
    const c = ac8Colors(t);
    const days = this.store.kpiDay.rows();
    const week = this.store.storyWeek();
    const focus = this.store.focus();
    return TILES.map((d) => {
      const color = d.color(c);
      const data = days.map((x) => [dayMs(x.von), x[d.key] ?? 0]);
      const spark: EChartsCoreOption = {
        animationDuration: 400,
        grid: { left: 0, right: 0, top: 2, bottom: 0 },
        xAxis: { type: 'time', show: false },
        yAxis: { type: 'value', show: false, min: 0 },
        tooltip: {
          trigger: 'axis', confine: true, axisPointer: { type: 'line', lineStyle: { color: t.axis } },
          formatter: (ps: { value: [number, number] }[]) => ttHead(dateShort(ps[0].value[0])) + ttRow(color, d.label, num(ps[0].value[1])),
        },
        series: [{
          type: 'line', data, showSymbol: false, step: 'middle', lineStyle: { width: 1.5, color: color ?? t.ink2 },
          areaStyle: { color: color ?? t.ink2, opacity: 0.12 },
          markArea: week ? { silent: true, itemStyle: { color: t.grid, opacity: 0.9 }, data: [[{ xAxis: dayMs(week.from) }, { xAxis: dayMs(week.to)! + 86_399_000 }]] } : undefined,
        }],
      };
      return {
        key: d.key, label: d.label, focus: d.focus, color, active: d.focus != null && d.focus === focus,
        value: r ? num(r[d.key]) : BLANK, note: r && d.note ? d.note(r) : '', spark,
      };
    });
  });

  protected pick(f: StandKey | null): void {
    if (!f) return;
    this.store.focus.set(this.store.focus() === f ? null : f);
  }
}
