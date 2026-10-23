import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac4Colors } from '../data/palette';
import { Ac4Store, monthLabel } from '../data/store';
import { KommRow } from '../data/types';

const VERLAUF = ['unverändert', 'vor Akzeptanz geändert', 'nach Akzeptanz geändert, neu versendet', 'nach Akzeptanz geändert, nicht versendet'] as const;
const AKZ: Record<string, string> = { automatisch: 'akzeptiert (automatisch)', 'von Hand': 'von der Person bestätigt' };
const NICHT_AKZ = 'nicht akzeptiert';

/**
 * View 5 - Änderungen & Akzeptanz (fico_kommunikation, one row per shift). Sankey: shifts in scope ->
 * kommuniziert / nie kommuniziert -> Akzeptanz (automatisch / von der Person / keine) -> Verlauf (unverändert,
 * vor Akzeptanz geändert, nach Akzeptanz geändert und neu versendet / nicht versendet). Link widths are sums of
 * the returned [Anzahl Schichten (Kommunikation)] groups of the selected month(s) - each group is a disjoint
 * set of shifts. Right: the report's «Kommunizierte Schichten je Planmonat nach Änderungsverlauf». KPIs are the
 * report's measures. Acceptance is almost always set by CargoControl itself (F7); a version is not a change.
 */
@Component({
  selector: 'ac4-aenderungen',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Werden versendete Schichten nach der Akzeptanz noch geändert?" [q]="[store.komm, store.kommKpi]">
      <p class="ac4-answer">{{ answer() }}</p>
      <dl class="ac4-facts">
        @for (f of facts(); track f.label) {
          <div><dt>{{ f.label }}</dt><dd>{{ f.value }}</dd></div>
        }
      </dl>
      <div class="ac4-split ac4-split-wide">
        <div echarts class="chart" style="height: 340px" [options]="sankey()!" [theme]="theme.echartsTheme()"></div>
        <div echarts class="chart" style="height: 340px" [options]="months()!" [theme]="theme.echartsTheme()" (chartClick)="month($any($event))"></div>
      </div>
      <p class="ac4-cover">Jede Version ist ein Stand, den CargoControl an die Person geschickt hat. Eine Änderung zählt nur, wenn sich Tourelemente, Person oder Beginn/Ende gegenüber der vorherigen Version unterscheiden (ADR-054): {{ identisch() }} «akzeptiert (automatisch)»: CargoControl setzt den Status selbst; die Regel dahinter ist bei SaxMS angefragt (SAX-44).</p>
    </app-card>
  `,
})
export class AenderungenView {
  protected readonly store = inject(Ac4Store);
  protected readonly theme = inject(ThemeService);

  private readonly kpi = computed(() => {
    const m = this.store.month();
    const rows = this.store.kommKpi.rows();
    return (m ? rows.find((r) => r.planmonat === m) : rows.find((r) => r.ist_gesamt)) ?? null;
  });
  private readonly groups = computed<KommRow[]>(() => {
    const m = this.store.month();
    return this.store.komm.rows().filter((r) => !m || r.planmonat === m);
  });

  protected readonly answer = computed(() => {
    const k = this.kpi();
    if (!k || !k.kommuniziert) return '';
    return `Von ${num(k.kommuniziert)} kommunizierten Schichten (${monthLabel(this.store.month())}) wurden ${num(k.nach_geaendert)} nach der Akzeptanz geändert; ` +
      `nur ${num(k.nach_neu_versendet)} davon gingen neu an die Person, ${num(k.nach_nicht_versendet)} nicht.`;
  });
  protected readonly facts = computed(() => {
    const k = this.kpi();
    const v = (x: number | null | undefined) => (k ? num(x) : BLANK);
    return [
      { label: 'kommuniziert', value: v(k?.kommuniziert) },
      { label: 'akzeptiert (automatisch)', value: v(k?.akzeptiert_automatisch) },
      { label: 'von der Person bestätigt', value: v(k?.von_hand) },
      { label: 'vor Akzeptanz geändert', value: k ? `${num(k.vor_geaendert)} (${pct(k.anteil_vor)})` : BLANK },
      { label: 'nach Akzeptanz geändert', value: k ? `${num(k.nach_geaendert)} (${pct(k.anteil_nach, 1)})` : BLANK },
      { label: 'Versionen je Schicht', value: k ? num(k.versionen_je_schicht, 2) : BLANK },
    ];
  });
  protected readonly identisch = computed(() => {
    const k = this.kpi();
    if (!k || !k.folgeversionen) return '';
    return `von ${num(k.folgeversionen)} Folgeversionen sind ${num(k.identisch)} inhaltlich identisch (${pct((k.identisch ?? 0) / k.folgeversionen)}) - Neuversand, weil sich am selben Tag der Person etwas anderes geändert hat.`;
  });

  protected readonly sankey = computed<EChartsCoreOption | null>(() => {
    const g = this.groups();
    if (!g.length) return null;
    const t = this.theme.tokens();
    const c = ac4Colors(this.theme.mode());
    const links = new Map<string, number>();
    const add = (a: string, b: string, n: number) => n && links.set(`${a}\u0000${b}`, (links.get(`${a}\u0000${b}`) ?? 0) + n);
    for (const r of g) {
      const n = r.schichten ?? 0;
      if (r.verlauf === 'nie kommuniziert' || !r.verlauf) {
        add('Schichten', 'nie kommuniziert', n);
        continue;
      }
      const akz = r.akzeptanzart ? (AKZ[r.akzeptanzart] ?? r.akzeptanzart) : NICHT_AKZ;
      add('Schichten', 'kommuniziert', n);
      add('kommuniziert', akz, n);
      add(akz, r.verlauf, n);
    }
    const color: Record<string, string> = {
      Schichten: t.ink2, kommuniziert: c.plan, 'nie kommuniziert': c.neutral,
      [AKZ['automatisch']]: c.plan, [AKZ['von Hand']]: c.ist, [NICHT_AKZ]: c.neutral,
      ...c.verlauf, 'unverändert': this.theme.mode() === 'dark' ? t.axis : '#cfc8bf',
    };
    const names = new Set<string>();
    for (const k of links.keys()) k.split('\u0000').forEach((x) => names.add(x));
    return {
      aria: ariaDecal(),
      tooltip: {
        confine: true,
        formatter: (p: { dataType: string; data: { source?: string; target?: string; value?: number; name?: string }; value: number }) =>
          p.dataType === 'edge' ? ttHead(`${p.data.source} → ${p.data.target}`) + ttRow(null, 'Schichten', num(p.data.value))
            : ttHead(p.data.name ?? '') + ttRow(null, 'Schichten', num(p.value)),
      },
      series: [{
        type: 'sankey', left: 4, right: 290, top: 8, bottom: 8, nodeGap: 10, nodeWidth: 12, draggable: false,
        layoutIterations: 0, emphasis: { focus: 'adjacency' },
        label: { color: t.ink, fontSize: 12, formatter: (p: { name: string; value: number }) => `${p.name}  {v|${num(p.value)}}`, rich: { v: { color: t.ink2, fontFamily: 'Bahnschrift, sans-serif' } } },
        lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
        data: [...names].map((name) => ({ name, itemStyle: { color: color[name] ?? t.axis, borderColor: t.surface } })),
        links: [...links].map(([k, value]) => { const [source, target] = k.split('\u0000'); return { source, target, value }; }),
      }],
    };
  });

  protected readonly months = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.komm.rows().filter((r) => r.planmonat && r.verlauf && r.verlauf !== 'nie kommuniziert');
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac4Colors(this.theme.mode());
    const ms = [...new Set(rows.map((r) => r.planmonat!))].sort();
    const sel = this.store.month();
    const lineCol = this.theme.mode() === 'dark' ? t.axis : '#cfc8bf';
    return {
      aria: ariaDecal(),
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: t.ink2, fontSize: 11 } },
      grid: { left: 4, right: 4, top: 52, bottom: 4, outerBounds: { left: 4, right: 4, top: 52, bottom: 4 } },
      xAxis: { type: 'category', data: ms.map((m) => monthLabel(m)) },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => num(v) } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { name: string; seriesName: string; value: number; color: string }[]) => ttHead(ps[0].name) + ps.map((p) => ttRow(p.color, p.seriesName, num(p.value))).join(''),
      },
      series: VERLAUF.map((v, i) => ({
        type: 'bar', stack: 'v', name: v, barMaxWidth: 34, cursor: 'pointer',
        itemStyle: { color: v === 'unverändert' ? lineCol : c.verlauf[v], borderColor: t.surface, borderWidth: 1, borderRadius: i === VERLAUF.length - 1 ? [4, 4, 0, 0] : 0 },
        data: ms.map((m) => ({
          value: rows.filter((r) => r.planmonat === m && r.verlauf === v).reduce((s, r) => s + (r.schichten ?? 0), 0),
          itemStyle: { opacity: (!sel || sel === m ? 1 : 0.35) * (this.store.incomplete(m) ? 0.6 : 1) },
        })),
      })),
    };
  });

  protected month(e: { dataIndex?: number }): void {
    const ms = [...new Set(this.store.komm.rows().filter((r) => r.planmonat && r.verlauf && r.verlauf !== 'nie kommuniziert').map((r) => r.planmonat!))].sort();
    const m = ms[e?.dataIndex ?? -1];
    if (m) this.store.pickMonth(this.store.month() === m ? null : m);
  }
}
