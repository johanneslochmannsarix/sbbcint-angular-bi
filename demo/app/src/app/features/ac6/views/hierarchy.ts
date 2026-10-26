import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num, pct } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { MergeOptions } from '../../../shared/merge-options';
import { ac6Colors, fahrenColor } from '../data/palette';
import { Ac6Store } from '../data/store';
import { HierRow } from '../data/types';
import { UiOption, UiSeg } from '../../../shared/ui';

type Lvl = 'firma' | 'ts' | 'pt' | 'taet';
const NEXT: Record<Lvl, Lvl | null> = { firma: 'ts', ts: 'pt', pt: 'taet', taet: null };
const LVL_LABEL: Record<Lvl, string> = { firma: 'Firma', ts: 'Tourstandort', pt: 'Personaltyp', taet: 'Tätigkeit' };
const PLURAL: Record<Lvl, string> = { firma: 'Firmen', ts: 'Tourstandorte', pt: 'Personaltypen', taet: 'Tätigkeiten' };

interface Node {
  id: string;
  lvl: Lvl;
  name: string;
  value: number;
  elemente: number;
  fahren: string | null;
  children?: Node[];
}

/**
 * View 2 - who carries the plan. A sunburst Firma -> Tourstandort -> Personaltyp -> Tätigkeit (area = planned
 * element hours, the outer ring coloured by the SaxMS flag Fahren ja / nein - no classification, ADR-046), rooted
 * at the deepest picked level, so a click drills (Firma / Tourstandort / Personaltyp / Tätigkeit filter) and the
 * ring re-roots. «Rangliste» morphs the next ring into a ranked bar list (universalTransition, ids shared by node).
 * Hours are additive over disjoint leaves; the inner rings and the bars are sums of the returned leaves (layout).
 */
@Component({
  selector: 'ac6-hierarchy',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, MergeOptions, UiSeg],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wer trägt die Planung?" [q]="store.hier" emptyNote="Unter diesem Filter plant die Version nichts.">
      <div card-tools class="ac6-tools">
        <ui-seg size="sm" ariaLabel="Darstellung" [options]="shapeOptions" [value]="shape()" (valueChange)="shape.set($event)" />
      </div>
      <p class="ac6-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="height()" [options]="blank" [mergeOptions]="options()" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))" aria-label="Firma, Tourstandort, Personaltyp und Tätigkeit nach geplanten Stunden; anklicken vertieft"></div>
      <div class="ac6-legend">
        <span><i [style.background]="colors().fahren"></i>Tätigkeit mit Fahren = ja</span>
        <span><i [style.background]="colors().jup"></i>Fahren = nein</span>
        <span><i [style.background]="colors().neutral"></i>ohne Kennzeichen</span>
      </div>
      <p class="ac6-note">Klassifikation im Controlling-Workbook: Kernleistung, Reserve und Dispo werden hier nicht zugeordnet (ADR-046). Firma ist die Firma des Tourstandorts.</p>
    </app-card>
  `,
})
export class HierarchyView {
  protected readonly store = inject(Ac6Store);
  protected readonly theme = inject(ThemeService);
  protected readonly shape = signal<'ring' | 'rang'>('ring');
  protected readonly shapeOptions: UiOption<'ring' | 'rang'>[] = [
    { value: 'ring', label: 'Ringe' },
    { value: 'rang', label: 'Rangliste' },
  ];
  protected readonly blank: EChartsCoreOption = {};
  protected readonly colors = computed(() => ac6Colors(this.theme.mode()));

  private readonly tree = computed<Node[]>(() => {
    const root = new Map<string, Node>();
    const put = (m: Map<string, Node>, parent: Node | null, lvl: Lvl, name: string, r: HierRow): Node => {
      const id = `${parent ? parent.id + '›' : ''}${name}`;
      let n = m.get(id);
      if (!n) {
        n = { id, lvl, name, value: 0, elemente: 0, fahren: lvl === 'taet' ? r.fahren : null, children: lvl === 'taet' ? undefined : [] };
        m.set(id, n);
        parent?.children!.push(n);
      }
      n.value += r.dauer_h ?? 0;
      n.elemente += r.tourelemente ?? 0;
      return n;
    };
    const all = new Map<string, Node>();
    for (const r of this.store.hier.rows()) {
      const f = put(all, null, 'firma', r.firma ?? '–', r);
      root.set(f.id, f);
      const ts = put(all, f, 'ts', r.tourstandort ?? '–', r);
      const pt = put(all, ts, 'pt', r.personaltyp ?? '(ohne Personaltyp)', r);
      put(all, pt, 'taet', r.taetigkeit ?? '(ohne Tätigkeit)', r);
    }
    const sort = (ns: Node[]) => { ns.sort((a, b) => b.value - a.value); ns.forEach((n) => n.children && sort(n.children)); return ns; };
    return sort([...root.values()]);
  });

  /** the subtree the page is drilled into (deepest picked Firma / Tourstandort / Personaltyp) */
  private readonly focus = computed<{ path: Node[]; nodes: Node[] }>(() => {
    let nodes = this.tree();
    const path: Node[] = [];
    const want: [Lvl, string | null][] = [['firma', this.store.firmaName()], ['ts', this.store.standortName()], ['pt', this.store.ptypName()]];
    for (const [, name] of want) {
      if (!name) break;
      const hit = nodes.find((n) => n.name === name);
      if (!hit?.children) break;
      path.push(hit);
      nodes = hit.children;
    }
    return { path, nodes };
  });

  /** one height for both shapes: a resize during a universalTransition morph leaves the old shapes stuck (2026-10-21) */
  protected readonly height = signal(470);

  protected readonly answer = computed(() => {
    const { path, nodes } = this.focus();
    if (!nodes.length) return '';
    const total = nodes.reduce((s, n) => s + n.value, 0);
    const lvl = nodes[0].lvl;
    const top = nodes.slice(0, 3);
    const where = path.length ? ` in ${path[path.length - 1].name}` : '';
    const head = top.length === 1 ? `Eine ${LVL_LABEL[lvl]} trägt` : `Die ${top.length} grössten ${PLURAL[lvl]} tragen`;
    return `${head}${where} ${pct(top.reduce((s, n) => s + n.value, 0) / (total || 1))} der ${hours(total, 0)}: ` +
      top.map((n) => `${n.name} (${hours(n.value, 0)})`).join(', ') + '.';
  });

  private colorOf(n: Node): string {
    const c = this.colors();
    if (n.lvl === 'taet') return fahrenColor(c, n.fahren);
    const shade = { firma: c.seq[5], ts: c.seq[3], pt: c.seq[2] }[n.lvl as 'firma' | 'ts' | 'pt'];
    return shade;
  }

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const { nodes } = this.focus();
    if (!nodes.length) return null;
    const t = this.theme.tokens();
    const c = this.colors();
    const dark = this.theme.mode() === 'dark';
    const selTaet = this.store.taetName();
    const byId = new Map<string, Node>();
    const toData = (ns: Node[]): object[] => ns.map((n) => {
      byId.set(n.id, n);
      const light = n.lvl === 'pt' || (n.lvl === 'ts' && !dark);
      return {
        id: n.id, name: n.name, value: n.value, lvl: n.lvl,
        itemStyle: { color: this.colorOf(n), borderColor: t.surface, borderWidth: 1.5, opacity: n.lvl === 'taet' && selTaet && n.name !== selTaet ? 0.35 : 1 },
        label: { color: light ? t.ink : '#ffffff' },
        children: n.children ? toData(n.children) : undefined,
      };
    });
    const tip = (n: Node) => ttHead(n.name) + ttRow(null, LVL_LABEL[n.lvl], '') +
      ttRow(n.lvl === 'taet' ? fahrenColor(c, n.fahren) : c.jup, 'Dauer Tourelemente', hours(n.value, 1)) +
      ttRow(null, 'Tourelemente', num(n.elemente)) + (n.lvl === 'taet' ? ttRow(null, 'Fahren (SaxMS)', n.fahren ?? '–') : '');
    const common = {
      aria: ariaDecal(),
      animationDurationUpdate: 800,
      tooltip: { confine: true, formatter: (p: { data?: { id?: string } }) => { const n = p.data?.id ? byId.get(p.data.id) : null; return n ? tip(n) : ''; } },
    };
    if (this.shape() === 'ring') {
      return {
        ...common,
        xAxis: { show: false, type: 'value' }, yAxis: { show: false, type: 'category', data: [] }, grid: { left: 0, top: 0, width: 1, height: 1 },
        series: [{
          id: 'ac6-sun', type: 'sunburst', nodeClick: false, sort: undefined, radius: ['12%', '96%'], center: ['50%', '50%'],
          universalTransition: { enabled: true, seriesKey: 'ac6-hier' }, data: toData(nodes), cursor: 'pointer',
          label: { fontSize: 11, minAngle: 9, overflow: 'truncate', fontFamily: FONT_NUM },
          levels: [{}, { r0: '12%', r: '40%', label: { rotate: 'tangential', minAngle: 14 } }, { r0: '40%', r: '62%', label: { minAngle: 9 } },
            { r0: '62%', r: '80%', label: { show: false } }, { r0: '80%', r: '96%', label: { show: false } }],
        }],
      };
    }
    const flat = nodes.slice(0, 20).reverse();                         // 20 rows fit the fixed height
    for (const n of flat) byId.set(n.id, n);
    return {
      ...common,
      grid: { left: 8, right: 70, top: 6, bottom: 8, outerBounds: { left: 8, right: 70, top: 6, bottom: 8 } },
      xAxis: { type: 'value', show: true, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (v: number) => num(v) } },
      yAxis: { type: 'category', show: true, data: flat.map((n) => n.name), axisLabel: { color: t.ink2, width: 190, overflow: 'truncate' } },
      series: [{
        id: 'ac6-rang', type: 'bar', universalTransition: { enabled: true, seriesKey: 'ac6-hier' }, barMaxWidth: 16, cursor: 'pointer',
        data: flat.map((n) => ({ id: n.id, name: n.name, value: n.value, lvl: n.lvl,
          itemStyle: { color: n.lvl === 'taet' ? fahrenColor(c, n.fahren) : c.jup, borderRadius: [0, 4, 4, 0], opacity: n.lvl === 'taet' && selTaet && n.name !== selTaet ? 0.35 : 1 } })),
        label: { show: true, position: 'right', color: t.ink2, fontFamily: FONT_NUM, formatter: (p: { value: number }) => hours(p.value, 0) },
      }],
    };
  });

  protected click(e: { data?: { id?: string; lvl?: Lvl; name?: string } }): void {
    const d = e?.data;
    if (!d?.lvl || !d.name) return;
    if (d.lvl === 'firma') this.store.pickFirma(this.store.rankOf('firma', d.name));
    else if (d.lvl === 'ts') this.store.pickStandort(this.store.rankOf('standort', d.name));
    else if (d.lvl === 'pt') {
      // a Personaltyp sits under its Tourstandort: pick the Tourstandort too (the drill path stays a path)
      const ts = d.id?.split('›')[1];
      if (ts && ts !== this.store.standortName()) this.store.pickStandort(this.store.rankOf('standort', ts));
      this.store.pickPtyp(this.store.rankOf('ptyp', d.name));
    } else {
      const r = this.store.rankOf('taet', d.name);
      this.store.pickTaet(this.store.taet() === r ? null : r);
    }
  }

  protected readonly next = NEXT;
}
