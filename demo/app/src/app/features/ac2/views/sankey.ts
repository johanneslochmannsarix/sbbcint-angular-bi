import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { DataStore, StatusByQualRow } from '../data/model';
import { SelectionService } from '../data/selection';
import { ThemeService } from '../data/theme';
import { num } from '../../../core/format';
import { StatusCode } from '../data/tokens';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ttHead, ttRow } from '../../../shared/chart-opts';

const COLS: [keyof StatusByQualRow, StatusCode][] = [
  ['anzahl_gueltig', 'VALID_GT_90'], ['anzahl_lt_90', 'VALID_LT_90'], ['anzahl_noch_nicht_gueltig', 'NOT_YET_VALID'],
  ['anzahl_abgelaufen', 'EXPIRED'], ['anzahl_ohne_datum', 'DATES_MISSING'], ['anzahl_fehlt', 'MISSING_NEVER'],
];

/**
 * View 6 (replaces «Anzahl MA pro Qualifikation und Status»). The numbers are the report's own:
 * CC = the five DAX measures, RT&S = Sum of agg_qualification_status_counts, both + MISSING_NEVER rows
 * (status_by_qualification). Model aggregates, so the heatmap brush does not filter this view.
 */
@Component({
  selector: 'app-sankey',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Status je Qualifikation" [sub]="sub()" [q]="store.sbq">
      <div card-tools class="seg seg-sm" role="group" aria-label="«Fehlt» einbeziehen">
        <button type="button" [attr.aria-pressed]="!withMissing()" (click)="withMissing.set(false)">Erfasste</button>
        <button type="button" [attr.aria-pressed]="withMissing()" (click)="withMissing.set(true)">mit «Fehlt»</button>
      </div>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"></div>
      <p class="chart-note">Zahlen aus dem Modell wie im Bericht (Übersicht), unabhängig von der Auswahl in der Matrix. Beschriftungen kleiner Knoten, die sich überlagern würden, stehen im Tooltip.
        @if (!withMissing() && unheld().length) { Ohne erfasste Zuordnung und deshalb nicht im Fluss: {{ unheld().join(', ') }}. }</p>
    </app-card>
  `,
})
export class SankeyView {
  protected readonly store = inject(DataStore);
  protected readonly sel = inject(SelectionService);
  protected readonly theme = inject(ThemeService);
  protected readonly withMissing = signal(false);

  private readonly rows = computed(() => {
    const cols = COLS.filter(([, s]) => this.withMissing() || s !== 'MISSING_NEVER');
    return this.store.sbq.rows().map((r) => ({
      sk: r.qualification_sk, name: r.qualification_name ?? '(ohne Bezeichnung)',
      parts: cols.map(([c, s]) => ({ status: s, n: (r[c] as number | null) ?? 0 })),
    })).map((r) => ({ ...r, total: r.parts.reduce((a, p) => a + p.n, 0) }));
  });
  protected readonly unheld = computed(() => this.rows().filter((r) => r.total === 0).map((r) => r.name));
  private readonly flowing = computed(() => this.rows().filter((r) => r.total > 0).sort((a, b) => b.total - a.total));

  protected readonly height = computed(() => Math.max(420, this.flowing().length * 22 + 40));
  protected readonly sub = computed(() => {
    const total = this.flowing().reduce((a, r) => a + r.total, 0);
    return `${num(total)} ${this.withMissing() ? 'Person-Qualifikations-Paare' : 'erfasste Zuordnungen'} aus ${this.flowing().length} Qualifikationen`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    if (!this.store.sbq.result()) return null;
    const t = this.theme.tokens();
    const labels = this.store.statusLabel();
    const rows = this.flowing();
    const used = new Set(rows.flatMap((r) => r.parts.filter((p) => p.n > 0).map((p) => p.status)));
    const statuses = COLS.map(([, s]) => s).filter((s) => used.has(s));
    const focus = this.sel.qualification();
    const nodes = [
      ...rows.map((r) => ({ name: `q:${r.sk}`, value: r.total, itemStyle: { color: r.sk === focus ? t.ink : t.axis, borderWidth: 0 }, label: { color: t.ink2 } })),
      ...statuses.map((s) => ({
        name: `s:${s}`, depth: 1,
        itemStyle: s === 'DATES_MISSING' ? { color: t.status[s], borderColor: t.ring, borderWidth: 1.5 } : { color: s === 'MISSING_NEVER' ? t.noName : t.status[s], borderWidth: 0 },
        label: { color: t.ink, fontWeight: 600 },
      })),
    ];
    const qName = new Map(rows.map((r) => [`q:${r.sk}`, r.name]));
    const links = rows.flatMap((r) => r.parts.filter((p) => p.n > 0).map((p) => ({ source: `q:${r.sk}`, target: `s:${p.status}`, value: p.n })));
    const text = (id: string) => (id.startsWith('s:') ? labels[id.slice(2) as StatusCode] : qName.get(id) ?? id);
    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataType: string; data: { source?: string; target?: string; value?: number; name?: string }; value: number }) => p.dataType === 'edge'
          ? ttHead(text(p.data.source!)) + ttRow(null, text(p.data.target!), num(p.data.value))
          : ttHead(text(p.data.name!)) + ttRow(null, 'Summe', num(p.value)),
      },
      series: [{
        type: 'sankey', left: 236, right: 150, top: 8, bottom: 8, nodeWidth: 10, nodeGap: 12, nodeAlign: 'left', layoutIterations: 0, draggable: false,
        emphasis: { focus: 'adjacency' },
        data: nodes, links,
        labelLayout: { hideOverlap: true },
        label: { fontSize: 11, formatter: (p: { name: string }) => text(p.name), overflow: 'truncate', width: 220 },
        levels: [{ depth: 0, label: { position: 'left' } }, { depth: 1, label: { position: 'right' } }],
        lineStyle: { color: 'target', opacity: 0.35, curveness: 0.5 },
      }],
    };
  });

  protected click(e: { dataType?: string; data?: { name?: string } }): void {
    const n = e.data?.name;
    if (e.dataType === 'node' && n?.startsWith('q:')) this.sel.qualification.set(n.slice(2));
  }
}
