import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac7Store } from '../data/store';
import { GA_OF_KEY, Ga, STATUS_LABEL, StatusCode } from '../data/types';
import { GA_NAME, GA_ORDER, STATUS_GLYPH, ac7Colors } from '../data/palette';

type Kind = 'taet' | 'ga' | 'st';
const ID = { taet: (s: string) => `t:${s}`, ga: (s: string) => `g:${s}`, st: (s: string) => `s:${s}` };

/**
 * View 3 - population flow: Haupt-Personaltyp -> Geschäftsart -> Status, link width = [Anzahl Personen] per path
 * (the fluss query). The two link layers add up the same disjoint person counts (a person sits on one path). The
 * view ignores its own three filters; a picked node dims every flow that does not pass through it. Click = filter.
 */
@Component({
  selector: 'ac7-flow',
  imports: [NgxEchartsDirective, ChartCard, ChartResize],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wie teilt sich die Liste auf?" sub="Haupt-Personaltyp (laut SaxMS, als Tätigkeit) › Geschäftsart › Status; Klick auf einen Knoten filtert"
              [q]="store.fluss">
      <div echarts class="chart h-320" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($event)"></div>
      <p class="chart-note">Tätigkeit = Haupt-Personaltyp, vom Kunden so angenommen; das beschreibbare Feld unter Tätigkeit kommt nicht ins BI.</p>
    </app-card>
  `,
})
export class FlowView {
  protected readonly store = inject(Ac7Store);
  protected readonly theme = inject(ThemeService);

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.fluss.rows().filter((r) => (r.personen ?? 0) > 0 && r.taetigkeit && r.geschaeftsart && r.status_code);
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac7Colors(t);
    const st = this.store.status();
    const ga = this.store.ga() ? GA_OF_KEY[this.store.ga()!] : null;
    const taet = this.store.taet() != null ? this.store.taetByRank().get(this.store.taet()!) ?? null : null;
    const passes = (r: (typeof rows)[number]) => (!st || r.status_code === st) && (!ga || r.geschaeftsart === ga) && (!taet || r.taetigkeit === taet);
    const tl = new Map<string, number>();
    const tlOn = new Map<string, boolean>();
    const gs = new Map<string, number>();
    const gsOn = new Map<string, boolean>();
    for (const r of rows) {
      const a = `${r.taetigkeit}\u001f${r.geschaeftsart}`;
      const b = `${r.geschaeftsart}\u001f${r.status_code}`;
      tl.set(a, (tl.get(a) ?? 0) + (r.personen ?? 0));
      gs.set(b, (gs.get(b) ?? 0) + (r.personen ?? 0));
      if (passes(r)) {
        tlOn.set(a, true);
        gsOn.set(b, true);
      }
    }
    const any = st || ga || taet;
    const taets = [...new Set(rows.map((r) => r.taetigkeit!))].sort((x, y) => x.localeCompare(y, 'de'));
    const gas = GA_ORDER.filter((g) => rows.some((r) => r.geschaeftsart === g));
    const sts: StatusCode[] = (['AKTIV', 'INAKTIV'] as StatusCode[]).filter((s) => rows.some((r) => r.status_code === s));
    const picked = (k: Kind, v: string) => (k === 'taet' ? taet === v : k === 'ga' ? ga === v : st === v);
    const node = (k: Kind, v: string, name: string, color: string) => ({
      name: ID[k](v), label: { formatter: name }, kind: k, value: v,
      itemStyle: { color, borderColor: picked(k, v) ? t.ink : t.surface, borderWidth: picked(k, v) ? 2 : 1 },
    });
    const nodes = [
      ...taets.map((x) => node('taet', x, x, t.ink2)),
      ...gas.map((g) => node('ga', g, g, c.ga[g as Ga])),
      ...sts.map((s) => node('st', s, `${STATUS_GLYPH[s]} ${STATUS_LABEL[s]}`, c.status[s])),
    ];
    const link = (source: string, target: string, value: number, on: boolean, color: string) => ({
      source, target, value, lineStyle: { color, opacity: !any ? 0.35 : on ? 0.6 : 0.08 },
    });
    const links = [
      ...[...tl].map(([k, v]) => {
        const [a, b] = k.split('\u001f');
        return link(ID.taet(a), ID.ga(b), v, !!tlOn.get(k), c.ga[b as Ga]);
      }),
      ...[...gs].map(([k, v]) => {
        const [a, b] = k.split('\u001f');
        return link(ID.ga(a), ID.st(b), v, !!gsOn.get(k), c.ga[a as Ga]);
      }),
    ];
    const label = (id: string) => nodes.find((n) => n.name === id)?.label.formatter ?? id;
    return {
      aria: ariaDecal(),
      tooltip: {
        confine: true,
        formatter: (p: { dataType: string; data: { source?: string; target?: string; value?: number | string; kind?: Kind }; value: number; name: string }) => {
          if (p.dataType === 'edge') return ttHead(`${label(p.data.source!)} › ${label(p.data.target!)}`) + ttRow(null, 'Personen', num(p.value));
          const k = p.data.kind!;
          const v = String(p.data.value);
          const what = k === 'ga' ? `${v} (${GA_NAME[v as Ga]})` : label(p.name);
          return ttHead(what) + ttRow(null, 'Personen', num(p.value)) + `<div style="opacity:.7;margin-top:4px">Klicken: ${picked(k, v) ? 'Filter aufheben' : 'danach filtern'}</div>`;
        },
      },
      series: [{
        type: 'sankey', left: 8, right: 96, top: 8, bottom: 8, nodeWidth: 12, nodeGap: 10, draggable: false,
        layoutIterations: 0, nodeAlign: 'justify',
        emphasis: { focus: 'adjacency' },
        label: { color: t.ink, fontSize: 12 },
        data: nodes, links,
      }],
    };
  });

  protected click(e: { dataType?: string; data?: unknown }): void {
    const d = e.data as { kind?: Kind; value?: string } | null | undefined;
    if (e.dataType !== 'node' || !d?.kind) return;
    const v = String(d.value);
    if (d.kind === 'taet') this.store.setTaet(v);
    else if (d.kind === 'ga') this.store.setGa(v as Ga);
    else this.store.setStatus(v as StatusCode);
  }
}
