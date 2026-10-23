import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { TENANT_LABEL } from '../data/api';
import { DataStore, Person } from '../data/model';
import { SelectionService } from '../data/selection';
import { ThemeService } from '../data/theme';
import { num, pct } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ttHead, ttRow } from '../../../shared/chart-opts';

const BINS = [0.1, 0.25, 0.5, 0.75];   // coverage bins -> sequential steps 1..5

interface Node {
  name: string; value: number; sk?: string; people: number; holders: number; valid: number; children?: Node[];
  itemStyle?: Record<string, unknown>;
  label?: Record<string, unknown>;
}

/**
 * View 4 (replaces the Übersicht cards + tenant slicer). Area = people holding the qualification (any
 * status except «Fehlt»); colour = coverage = holders / people in that org unit, one-hue ramp. CC: tenant ->
 * org unit (dim_tenant) -> qualification. RT&S: tenant -> qualification (the model has no org level).
 */
@Component({
  selector: 'app-coverage',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Abdeckung je Mandant und Qualifikation" [sub]="sub()" [q]="store.modelQueries"
      [forceEmpty]="!!store.model() && tree().value === 0" emptyNote="Niemand unter diesem Filter hält eine Qualifikation.">
      <div class="ramp" aria-label="Farbskala Abdeckung">
        <span>Abdeckung</span>
        @for (s of ramp(); track $index) { <i [style.background]="s.color" [title]="s.label"></i> }
        <span>{{ rampText }}</span>
      </div>
      <div echarts class="chart h-380" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"></div>
      <p class="chart-note">Fläche: Personen mit der Qualifikation; Farbe: Anteil an allen Personen der Einheit. Klick auf einen Mandantenkopf vergrössert ihn, Klick auf eine Qualifikation hebt sie in Kalender und Gültigkeitsfenstern hervor.
        @if (!hasOrg()) { RT&S hat im Modell keine Org-Ebene (der Bericht zeigt keine, und die Beziehung Fakt → dim_tenant trifft keine Zeile). }
        @if (empty().length) { Ohne jede gehaltene Qualifikation und deshalb ohne Fläche: {{ empty().join(', ') }}. }</p>
    </app-card>
  `,
  styles: [`
    .h-380 { height: 380px; }
    .ramp { display: flex; align-items: center; gap: 3px; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .ramp span { margin: 0 6px; }
    .ramp i { width: 22px; height: 10px; display: inline-block; border-radius: 2px; }
  `],
})
export class CoverageView {
  protected readonly store = inject(DataStore);
  protected readonly sel = inject(SelectionService);
  protected readonly theme = inject(ThemeService);
  protected readonly rampText = '< 10 % … ≥ 75 %';

  protected readonly hasOrg = computed(() => this.store.model()?.hasOrg ?? false);

  private steps = computed(() => {
    const s = this.theme.tokens().seq;
    return [s[1], s[2], s[3], s[4], s[5]];
  });
  protected readonly ramp = computed(() => {
    const labels = ['< 10 %', '10–25 %', '25–50 %', '50–75 %', '≥ 75 %'];
    return this.steps().map((color, i) => ({ color, label: labels[i] }));
  });
  /** fill + label colour; the label flips to dark ink on the light steps of the ramp */
  private styleFor(share: number): { itemStyle: { color: string }; label: { color: string } } {
    let i = 0;
    while (i < BINS.length && share >= BINS[i]) i++;
    const light = this.theme.mode() === 'light' ? i <= 1 : i >= 3;
    return { itemStyle: { color: this.steps()[i] }, label: { color: light ? '#15212b' : '#ffffff' } };
  }

  private qualNodes(people: Person[]): Node[] {
    const m = this.store.model()!;
    return m.quals.map((q) => {
      let holders = 0;
      let valid = 0;
      for (const p of people) {
        const c = p.cells.get(q.sk);
        if (!c) continue;
        holders++;
        if (c.status === 'VALID_GT_90' || c.status === 'VALID_LT_90') valid++;
      }
      return { name: q.name, sk: q.sk, value: holders, people: people.length, holders, valid,
        ...this.styleFor(people.length ? holders / people.length : 0) };
    }).filter((n) => n.value > 0);
  }

  protected readonly tree = computed<Node>(() => {
    const m = this.store.model();
    const people = this.sel.people();
    if (!m) return { name: '', value: 0, people: 0, holders: 0, valid: 0 };
    const root: Node = { name: TENANT_LABEL[m.tenant], value: 0, people: people.length, holders: 0, valid: 0 };
    if (m.hasOrg) {
      root.children = m.orgs.map((o) => {
        const members = people.filter((p) => p.orgSk === o.sk);
        const kids = this.qualNodes(members);
        const holders = kids.reduce((a, k) => a + k.holders, 0);
        return { name: o.name, value: holders, people: members.length, holders, valid: kids.reduce((a, k) => a + k.valid, 0), children: kids,
          ...this.styleFor(members.length ? holders / (members.length * m.quals.length) : 0) } as Node;
      }).filter((n) => n.people > 0);
    } else {
      root.children = this.qualNodes(people);
    }
    root.holders = root.value = root.children.reduce((a, c) => a + c.value, 0);
    return root;
  });

  protected readonly empty = computed(() => {
    const m = this.store.model();
    if (!m?.hasOrg) return [];
    return (this.tree().children ?? []).filter((n) => n.value === 0).map((n) => `${n.name} (${num(n.people)} Personen)`);
  });

  protected readonly sub = computed(() => {
    const m = this.store.model();
    if (!m) return '';
    const who = this.sel.active() ? `Auswahl ${this.sel.brushLabel()}` : 'alle Personen';
    return m.hasOrg ? `${TENANT_LABEL[m.tenant]} → Mandant → Qualifikation, ${who}` : `${TENANT_LABEL[m.tenant]} → Qualifikation, ${who}`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const m = this.store.model();
    if (!m) return null;
    const t = this.theme.tokens();
    const tree = this.tree();
    const org = m.hasOrg;
    return {
      animation: false,
      tooltip: {
        formatter: (p: { data: Node; treePathInfo: { name: string }[] }) => {
          const d = p.data;
          if (!d || d.people == null) return '';
          const path = p.treePathInfo.slice(1).map((x) => x.name).join(' › ');
          const isQual = !!d.sk;
          return ttHead(path || d.name)
            + ttRow(null, 'Personen in der Einheit', num(d.people))
            + (isQual
              ? ttRow(null, 'mit Qualifikation', `${num(d.holders)} (${pct(d.people ? d.holders / d.people : 0)})`)
                + ttRow(t.status.VALID_GT_90, 'davon gültig', num(d.valid)) + ttRow(null, 'Fehlt', num(d.people - d.holders))
              : ttRow(null, 'gehaltene Qualifikationen', num(d.holders)));
        },
      },
      series: [{
        type: 'treemap', name: tree.name, data: tree.children, roam: false, nodeClick: org ? 'zoomToNode' : false,
        leafDepth: undefined, top: 30, left: 0, right: 0, bottom: 4, squareRatio: 1.2,
        breadcrumb: { show: true, top: 0, left: 0, height: 22, itemStyle: { color: t.surface, borderColor: t.axis, textStyle: { color: t.ink2 } }, emphasis: { itemStyle: { color: t.grid } } },
        label: { show: true, formatter: (p: { name: string; data: Node }) => (p.data.sk ? `${p.name}\n${num(p.data.holders)} von ${num(p.data.people)}` : p.name), fontSize: 11, overflow: 'truncate' },
        upperLabel: { show: true, height: 20, color: t.ink, backgroundColor: 'transparent', formatter: (p: { name: string; data: Node }) => `${p.name}: ${num(p.data.people)} Personen` },
        itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2 },
        levels: [
          { itemStyle: { borderColor: t.surface, borderWidth: 0, gapWidth: 3 }, upperLabel: { show: false } },
          { itemStyle: { borderColor: t.grid, borderWidth: 3, gapWidth: 2 }, upperLabel: { show: true, color: t.ink } },
          { itemStyle: { borderColor: t.surface, borderWidth: 1, gapWidth: 1 } },
        ],
      }],
    };
  });

  protected click(e: { data?: Node }): void {
    if (e.data?.sk) this.sel.qualification.set(e.data.sk);
  }
}
