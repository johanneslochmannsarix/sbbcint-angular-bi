import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { DECAL, STAND_ORDER, StandKey, ac8Colors, standColor } from '../data/palette';
import { Ac8Store } from '../data/store';

const RM_ORDER = ['automatisch akzeptiert', 'akzeptiert', 'versendet', 'abgelehnt', 'veraltet', 'keine Rückmeldung'];

interface Node { name: string; label: string; depth: number; color: string; decal?: object; stand?: StandKey }

/**
 * View 3 - where do shifts get stuck between plan and employee? Sankey over the pipeline query (counts are
 * [Anzahl Schichten] / [Anzahl Dienstplan gelöscht]): planned -> pointer state -> Rückmeldung of the
 * communicated version -> does the newest version still match it. A second source on the left carries the
 * shifts deleted after communication (fact_dienstplan, rule v3), which fact_shift no longer holds.
 * «veraltet» is a Rückmeldung value only (status 5 = person-day superseded, not a communicated removal).
 * Clicking a node or a flow opens the masked shift list.
 */
@Component({
  selector: 'ac8-pipeline',
  imports: [NgxEchartsDirective, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Kommunikations-Pipeline" [sub]="sub()" [q]="store.pipeline">
      <div echarts class="chart" style="height: 400px" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"></div>
      <p class="chart-note">«Kommuniziert» heisst: der Pointer zeigt auf eine Version (ADR-049), nie die jüngste Version oder ein Status. «Veraltet» bedeutet: für denselben Personentag wurde ein neuerer Stand kommuniziert, nicht dass eine Entfernung mitgeteilt wurde. Fluss oder Knoten anklicken zeigt die Schichten.</p>
    </app-card>
  `,
})
export class PipelineView {
  protected readonly store = inject(Ac8Store);
  protected readonly theme = inject(ThemeService);

  protected readonly sub = computed(() => {
    const rows = this.store.pipeline.rows();
    const plan = rows.filter((r) => r.quelle === 'fact_shift').reduce((a, r) => a + (r.n ?? 0), 0);
    const gone = rows.filter((r) => r.quelle === 'fact_dienstplan').reduce((a, r) => a + (r.n ?? 0), 0);
    const w = this.store.storyWeek();
    const scope = w ? w.label : 'im Fenster';
    const brush = this.store.brush() ? ', nur Schichten mit einer Version in der Auswahl der Vorlaufzeit' : '';
    return `${num(plan)} geplante und ${num(gone)} nach Kommunikation gelöschte Schichten ${scope}${brush}`;
  });

  private readonly graph = computed(() => {
    const c = ac8Colors(this.theme.tokens());
    const t = this.theme.tokens();
    const rows = this.store.pipeline.rows();
    const nodes = new Map<string, Node>();
    const links = new Map<string, { source: string; target: string; value: number }>();
    const add = (n: Node) => nodes.set(n.name, n);
    const link = (s: string, tg: string, v: number) => {
      if (!v) return;
      const k = `${s}>${tg}`;
      const l = links.get(k);
      if (l) l.value += v;
      else links.set(k, { source: s, target: tg, value: v });
    };
    add({ name: 's0:plan', label: 'Geplant (fact_shift)', depth: 0, color: t.ink2 });
    for (const r of rows) {
      const n = r.n ?? 0;
      if (r.quelle === 'fact_dienstplan') {
        add({ name: 's0:gone', label: 'Nach Kommunikation gelöscht', depth: 0, color: t.ink2 });
        add({ name: 's1:gelöscht', label: 'gelöscht, nicht nachweisbar', depth: 1, color: c.geloescht, decal: DECAL.geloescht, stand: 'gelöscht' });
        link('s0:gone', 's1:gelöscht', n);
        continue;
      }
      const stand = r.stand as StandKey;
      add({ name: `s1:${stand}`, label: stand, depth: 1, color: standColor(c, stand), decal: stand === 'unbesetzt' ? DECAL.unbesetzt : undefined, stand });
      link('s0:plan', `s1:${stand}`, n);
      if (stand !== 'kommuniziert') continue;
      const rm = r.rueckmeldung_label ?? 'keine Rückmeldung';
      add({ name: `s2:${rm}`, label: rm, depth: 2, color: c.rueckmeldung[rm] ?? t.neutral });
      link(`s1:${stand}`, `s2:${rm}`, n);
      const ab = r.weicht_ab ? 's3:ab' : 's3:gleich';
      add({ name: 's3:ab', label: 'jüngster Stand weicht ab', depth: 3, color: c.geaendert });
      add({ name: 's3:gleich', label: 'jüngster Stand = kommuniziert', depth: 3, color: c.kommuniziert });
      link(`s2:${rm}`, ab, n);
    }
    const order = (n: Node) => {
      if (n.depth === 1) return STAND_ORDER.indexOf((n.stand ?? 'unbesetzt') as StandKey);
      if (n.depth === 2) return RM_ORDER.indexOf(n.label);
      return n.name.endsWith('gone') || n.name.endsWith('ab') ? 1 : 0;
    };
    const used = new Set([...links.values()].flatMap((l) => [l.source, l.target]));
    const list = [...nodes.values()].filter((n) => used.has(n.name)).sort((a, b) => a.depth - b.depth || order(a) - order(b));
    return { nodes: list, links: [...links.values()] };
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const { nodes, links } = this.graph();
    const focus = this.store.focus();
    const label = new Map(nodes.map((n) => [n.name, n.label]));
    return {
      aria: ariaDecal(), // explicit decals on unbesetzt / gelöscht only
      animationDurationUpdate: 700,
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: { dataType: string; data: { source?: string; target?: string; value?: number; name?: string }; value: number }) =>
          p.dataType === 'edge'
            ? ttHead(`${label.get(p.data.source!)} → ${label.get(p.data.target!)}`) + ttRow(null, 'Schichten', num(p.data.value))
            : ttHead(label.get(p.data.name!) ?? '') + ttRow(null, 'Schichten', num(p.value)),
      },
      series: [{
        type: 'sankey', left: 8, right: 170, top: 8, bottom: 8, nodeWidth: 12, nodeGap: 18, layoutIterations: 0, draggable: false,
        emphasis: { focus: 'adjacency' },
        data: nodes.map((n) => ({
          name: n.name, depth: n.depth,
          itemStyle: { color: n.color, borderWidth: 0, decal: n.decal, opacity: focus && n.stand && n.stand !== focus ? 0.3 : 1 },
          label: { color: t.ink, fontWeight: focus && n.stand === focus ? 700 : 400 },
        })),
        links,
        label: { fontSize: 11.5, formatter: (p: { name: string; value: number }) => `${label.get(p.name)}  ${num(p.value)}` },
        lineStyle: { color: 'gradient', opacity: 0.32, curveness: 0.5 },
      }],
    };
  });

  protected click(e: { dataType?: string; data?: { name?: string; source?: string; target?: string } }): void {
    const lbl = (id: string) => this.graph().nodes.find((n) => n.name === id)?.label ?? id;
    const node = e.dataType === 'edge' ? e.data?.target : e.data?.name;
    const from = e.dataType === 'edge' ? e.data?.source : null;
    if (!node) return;
    const [stage, value] = [node.slice(0, 2), node.slice(3)];
    if (stage === 's0') {
      this.store.flow.set(value === 'gone' ? { title: 'Nach Kommunikation gelöscht', stand: 'gelöscht' } : { title: 'Alle geplanten Schichten', stand: '*' });
    } else if (stage === 's1') {
      this.store.flow.set({ title: lbl(node), stand: value });
    } else if (stage === 's2') {
      this.store.flow.set({ title: `kommuniziert, Rückmeldung «${value}»`, stand: 'kommuniziert', rueckmeldung: value });
    } else if (stage === 's3') {
      const rm = from?.startsWith('s2:') ? from.slice(3) : null;
      this.store.flow.set({ title: `${rm ? `«${rm}», ` : ''}${lbl(node)}`, stand: 'kommuniziert', rueckmeldung: rm, weichtAb: value === 'ab' });
    }
  }
}
