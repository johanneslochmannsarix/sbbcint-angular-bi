import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, hours, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { NUM_FONT, ac9Colors, hatch } from '../data/palette';
import { Ac9Store } from '../data/store';
import { KpiRow } from '../data/types';
import { RuleNote } from './rule-note';

interface Step {
  key: string;
  label: string;
  base: number;
  value: number | null;
  color: string;
  kind: 'total' | 'minus' | 'part' | 'ghost';
  note: string;
}

/**
 * View 1 - the hero: the month's statement of account as a waterfall. IST brutto, minus the reported pauses,
 * equals the billable hours; the billable bar then splits into what it is made of (Einsatz and the rest, AZU,
 * Fahrten - all billed). Einarbeitung stands outside the total as an empty dotted slot: it is never billed and
 * the model does not carry it (no number to show, so none is drawn). Beside the chart the same statement as
 * invoice lines per Geschäftsart. Every figure is a model measure; «Einsatz und übrige Zeit» is ohne Pause − AZU
 * − Fahrten, computed in the query (README (*)).
 */
@Component({
  selector: 'ac9-beleg',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, RuleNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .bl { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 20px; align-items: start; }
    .bl-chart { height: 330px; }
    .lines { width: 100%; border-collapse: collapse; font-size: 13px; }
    .lines th { text-align: right; font-weight: 600; color: var(--ink-2); padding: 4px 8px; border-bottom: 1px solid var(--rule-strong); }
    .lines th:first-child, .lines td:first-child { text-align: left; padding-left: 0; }
    .lines td { padding: 6px 8px; border-bottom: 1px solid var(--rule); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .lines tr.sum td { border-top: 2px solid var(--ink); border-bottom: 3px double var(--ink); font-weight: 600; color: var(--ink); }
    .lines tr.part td:first-child { padding-left: 14px; color: var(--ink-2); }
    .lines tr.minus td { color: var(--ink-2); }
    .lines tr.ghost td { color: var(--muted); font-style: italic; border-bottom: 0; }
    .lines .sh { color: var(--muted); font-size: 11.5px; margin-left: 4px; }
    .k { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; vertical-align: 0; }
    .k-ghost { border: 1.5px dotted var(--muted); background: transparent; }
    @media (max-width: 1000px) { .bl { grid-template-columns: minmax(0, 1fr); } }
  `],
  template: `
    <app-card heading="Wie wird aus der IST-Zeit die abrechenbare Zeit?" [q]="store.kpi" sub="Abrechnungsbeleg {{ store.rangeTextLong() }}">
      <p class="ac9-answer">{{ answer() }}</p>
      <div class="bl">
        <div echarts class="chart bl-chart" [options]="options() ?? {}" [theme]="theme.echartsTheme()"
             aria-label="Wasserfall: IST brutto, minus Pause, gleich abrechenbar, davon Einsatz, AZU und Fahrten; Einarbeitung ausserhalb, nicht im Modell"></div>
        <table class="lines" aria-label="Abrechnungsbeleg je Geschäftsart">
          <thead><tr><th>Position</th><th>AÜ</th><th>DL</th><th>Summe</th></tr></thead>
          <tbody>
            @for (l of lines(); track l.key) {
              <tr [class]="l.cls">
                <td><i class="k" [class.k-ghost]="l.cls === 'ghost'" [style.background]="l.cls === 'ghost' ? null : l.color"></i>{{ l.label }}</td>
                <td>{{ l.aue }}</td><td>{{ l.dl }}</td>
                <td>{{ l.sum }}@if (l.share) {<span class="sh">{{ l.share }}</span>}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <ac9-rule [keys]="['ist', 'netto', 'einarbeitung']" />
    </app-card>
  `,
})
export class Beleg {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);

  private readonly steps = computed<Step[] | null>(() => {
    const r = this.store.kpiTotal();
    if (!r) return null;
    const c = ac9Colors(this.theme.mode());
    return [
      { key: 'brutto', label: 'IST brutto', base: 0, value: r.brutto_h, color: c.total, kind: 'total', note: 'Beginn bis Ende jeder zurückgemeldeten Tour' },
      { key: 'pause', label: '− Pause', base: r.netto_h, value: r.pause_h, color: c.pause, kind: 'minus', note: 'zurückgemeldete Pausen, nicht abgerechnet' },
      { key: 'netto', label: '= abrechenbar', base: 0, value: r.netto_h, color: c.total, kind: 'total', note: 'ohne Pause; AZU und Fahrten sind enthalten' },
      { key: 'rest', label: 'Einsatz u. übrige', base: 0, value: r.rest_h, color: c.einsatz, kind: 'part', note: 'abrechenbar ohne AZU und Fahrten' },
      { key: 'azu', label: 'AZU', base: r.rest_h, value: r.azu_h, color: c.azu, kind: 'part', note: 'Arbeitszeitunterbrechungen, abgerechnet' },
      { key: 'fahrt', label: 'Fahrten', base: r.rest_h + r.azu_h, value: r.fahrt_h, color: c.fahrt, kind: 'part', note: 'Dienst- und Gastfahrten, abgerechnet' },
      { key: 'ein', label: 'Einarbeitung', base: 0, value: null, color: c.plan, kind: 'ghost', note: 'nie verrechnet, nicht im Modell' },
    ];
  });

  protected readonly answer = computed(() => {
    const r = this.store.kpiTotal();
    if (!r) return '';
    if (!r.touren) return 'In dieser Auswahl ist keine Tour zurückgemeldet.';
    return `Von ${hours(r.brutto_h)} IST gehen ${hours(r.pause_h)} Pause ab (${pct(r.anteil_pause, 1)}); abrechenbar sind ${hours(r.netto_h)}. ` +
      `AZU macht ${pct(r.anteil_azu, 1)} und Fahrten ${pct(r.anteil_fahrt, 1)} der IST-Zeit aus, beide werden abgerechnet. Einarbeitung kommt hier nicht vor, sie wird nie verrechnet.`;
  });

  protected readonly lines = computed(() => {
    const t = this.store.kpiTotal();
    const ga = (g: string) => this.store.kpiGa().find((r) => r.geschaeftsart === g) ?? null;
    const a = ga('AÜ');
    const d = ga('DL');
    const c = ac9Colors(this.theme.mode());
    const h = (r: KpiRow | null, k: keyof KpiRow) => (r ? hours(r[k] as number) : BLANK);
    return [
      { key: 'b', label: 'IST brutto', cls: 'minus', color: c.total, aue: h(a, 'brutto_h'), dl: h(d, 'brutto_h'), sum: h(t, 'brutto_h'), share: '' },
      { key: 'p', label: '− Pause', cls: 'minus', color: c.pause, aue: h(a, 'pause_h'), dl: h(d, 'pause_h'), sum: h(t, 'pause_h'), share: t ? pct(t.anteil_pause, 1) : '' },
      { key: 'n', label: '= abrechenbar', cls: 'sum', color: c.total, aue: h(a, 'netto_h'), dl: h(d, 'netto_h'), sum: h(t, 'netto_h'), share: '' },
      { key: 'r', label: 'davon Einsatz u. übrige', cls: 'part', color: c.einsatz, aue: h(a, 'rest_h'), dl: h(d, 'rest_h'), sum: h(t, 'rest_h'), share: '' },
      { key: 'z', label: 'davon AZU', cls: 'part', color: c.azu, aue: h(a, 'azu_h'), dl: h(d, 'azu_h'), sum: h(t, 'azu_h'), share: t ? pct(t.anteil_azu, 1) : '' },
      { key: 'f', label: 'davon Fahrten', cls: 'part', color: c.fahrt, aue: h(a, 'fahrt_h'), dl: h(d, 'fahrt_h'), sum: h(t, 'fahrt_h'), share: t ? pct(t.anteil_fahrt, 1) : '' },
      { key: 'e', label: 'nicht verrechnet: Einarbeitung', cls: 'ghost', color: c.plan, aue: '', dl: '', sum: 'nicht im Modell', share: '' },
    ];
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const steps = this.steps();
    if (!steps) return null;
    const t = this.theme.tokens();
    const mode = this.theme.mode();
    const cats = steps.map((s) => s.label);
    const max = Math.max(...steps.map((s) => (s.value ?? 0) + s.base));
    const ghostIdx = steps.findIndex((s) => s.kind === 'ghost');
    return {
      animationDuration: 500,
      aria: ariaDecal(),
      grid: { left: 8, right: 8, top: 26, bottom: 4, outerBounds: { left: 8, right: 8, top: 26, bottom: 4 } },
      xAxis: { type: 'category', data: cats, axisTick: { show: false }, axisLabel: { color: t.ink2, interval: 0, fontSize: 11.5 } },
      yAxis: { type: 'value', min: 0, max: Math.ceil(max * 1.08), splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (v: number) => `${Math.round(v / 1000)}k` } },
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: { dataIndex: number; seriesId: string }) => {
          const s = steps[p.dataIndex];
          if (!s) return '';
          return ttHead(s.label.replace(/^[−=] /, '')) + (s.value == null ? '' : ttRow(s.color, 'Stunden', hours(s.value))) +
            `<div style="max-width:240px;white-space:normal;color:${t.muted}">${s.note}</div>`;
        },
      },
      series: [
        { id: 'bl-base', type: 'bar', stack: 'w', silent: true, itemStyle: { color: 'transparent' }, emphasis: { disabled: true },
          data: steps.map((s) => (s.kind === 'ghost' ? null : s.base)), barMaxWidth: 46 },
        {
          id: 'bl-val', type: 'bar', stack: 'w', barMaxWidth: 46,
          data: steps.map((s) => (s.kind === 'ghost' ? null : {
            value: s.value,
            itemStyle: { color: s.color, borderRadius: [3, 3, 0, 0], decal: s.kind === 'minus' ? hatch(mode) : undefined },
          })),
          label: {
            show: true, position: 'top', color: t.ink, fontFamily: NUM_FONT, fontSize: 12,
            formatter: (p: { dataIndex: number; value: number }) => {
              const s = steps[p.dataIndex];
              return s?.kind === 'minus' ? `−${hours(p.value)}` : hours(p.value);
            },
          },
        },
        {
          id: 'bl-ghost', type: 'custom', silent: false, z: 1,
          data: [[ghostIdx, max]],
          renderItem: (_params: unknown, api: { coord: (v: number[]) => number[]; size: (v: number[]) => number[]; value: (i: number) => number }) => {
            const top = api.coord([api.value(0), api.value(1)]);
            const bottom = api.coord([api.value(0), 0]);
            const w = Math.min(46, api.size([1, 0])[0] * 0.6);
            return {
              type: 'group',
              children: [
                { type: 'rect', shape: { x: top[0] - w / 2, y: top[1], width: w, height: bottom[1] - top[1], r: 3 },
                  style: { fill: 'transparent', stroke: t.muted, lineDash: [2, 3], lineWidth: 1.5 } },
                { type: 'text', style: { text: 'nicht\nim\nModell', x: top[0], y: (top[1] + bottom[1]) / 2, fill: t.muted, align: 'center', verticalAlign: 'middle', font: '11px sans-serif', lineHeight: 15 } },
              ],
            };
          },
        },
      ],
    };
  });
}
