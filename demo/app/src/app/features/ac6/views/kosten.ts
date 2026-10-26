import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { HATCH, HATCH_DARK, KOSTEN_ORDER, ac6Colors } from '../data/palette';
import { Ac6Store } from '../data/store';
import { UiOption, UiSeg } from '../../../shared/ui';

/**
 * View 7 - cost-allocation mix per version: share of the elements (or of the planned hours) per Kostenallokation
 * code, one 100 % bar per version (shares of returned counts - layout only). The decode is settled by mass
 * (0 Keiner, 1 Auftrag, 2 Produkt, 3 Kostenstelle, 4 Sonstige, 5 Zugfahrt). Elements typed Kostenstelle without a
 * Kostenstelle are a data note, counted from the model (soft-deleted rows are not in it). Clicking a bar shows
 * that version everywhere.
 */
@Component({
  selector: 'ac6-kosten',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, UiSeg],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wie sind die Elemente je Version abgerechnet?" [q]="store.kosten" emptyNote="Unter diesem Filter plant keine Version Elemente.">
      <div card-tools class="ac6-tools">
        <ui-seg size="sm" ariaLabel="Basis" [options]="basisOptions" [value]="basis()" (valueChange)="basis.set($event)" />
      </div>
      <p class="ac6-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"
           aria-label="Anteile der Kostenallokation je JUP-Version"></div>
      <div class="ac6-legend">
        @for (l of legend(); track l.code) { <span><i [style.background]="l.color" [class.ac6-hatch]="l.code === 1"></i>{{ l.label }}</span> }
      </div>
      @if (note(); as n) { <p class="ac6-note">{{ n }}</p> }
    </app-card>
  `,
})
export class KostenView {
  protected readonly store = inject(Ac6Store);
  protected readonly theme = inject(ThemeService);
  protected readonly basis = signal<'elemente' | 'dauer_h'>('elemente');
  protected readonly basisOptions: UiOption<'elemente' | 'dauer_h'>[] = [
    { value: 'elemente', label: 'Elemente' },
    { value: 'dauer_h', label: 'Stunden' },
  ];

  private readonly labels = computed(() => {
    const m = new Map<number, string>();
    for (const r of this.store.kosten.rows()) if (r.code != null && r.kostenallokation) m.set(r.code, r.kostenallokation);
    return m;
  });
  protected readonly legend = computed(() => {
    const c = ac6Colors(this.theme.mode());
    return KOSTEN_ORDER.filter((k) => this.labels().has(k)).map((k) => ({ code: k, label: `${this.labels().get(k)} (${k})`, color: c.kosten[k] }));
  });

  private readonly byVersion = computed(() => {
    const b = this.basis();
    const m = new Map<string, { codes: Map<number, number>; total: number; ohne: number; elemente: number }>();
    for (const r of this.store.kosten.rows()) {
      if (!r.version || r.code == null) continue;
      const e = m.get(r.version) ?? { codes: new Map(), total: 0, ohne: 0, elemente: 0 };
      const v = (r[b] as number | null) ?? 0;
      e.codes.set(r.code, (e.codes.get(r.code) ?? 0) + v);
      e.total += v;
      e.ohne += r.ohne_kostenstelle ?? 0;
      e.elemente += r.elemente ?? 0;
      m.set(r.version, e);
    }
    return [...m.entries()].sort((a, b2) => b2[1].elemente - a[1].elemente);
  });

  protected readonly height = computed(() => Math.max(220, this.byVersion().length * 26 + 30));

  protected readonly answer = computed(() => {
    const vs = this.byVersion();
    const name = this.store.versionName();
    const mine = vs.find(([v]) => v === name)?.[1];
    if (!mine) return '';
    const top = [...mine.codes.entries()].sort((a, b) => b[1] - a[1])[0];
    return `In «${name}» entfallen ${pct(mine.total ? top[1] / mine.total : null)} der ${this.basis() === 'elemente' ? 'Elemente' : 'Stunden'} auf «${this.labels().get(top[0])}».`;
  });

  protected readonly note = computed(() => {
    const vs = this.byVersion();
    if (!vs.length) return '';
    const ohne = vs.filter(([, e]) => e.ohne > 0);
    const total = ohne.reduce((s, [, e]) => s + e.ohne, 0);
    const auftrag = vs.filter(([, e]) => (e.codes.get(1) ?? 0) > 0).map(([v]) => `«${v}»`);
    const parts: string[] = [];
    if (total) parts.push(`${num(total)} Elemente mit Kostenallokation «Kostenstelle» tragen keine Kostenstelle (${ohne.map(([v, e]) => `«${v}» ${num(e.ohne)}`).join(', ')}); ein Datenhinweis, kein Fehler.`);
    if (auftrag.length) parts.push(`Code 1 «Auftrag» kommt nur in ${auftrag.join(', ')} vor.`);
    parts.push('Gezählt wird im Modell (ohne gelöschte Zeilen).');
    return parts.join(' ');
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const vs = [...this.byVersion()].reverse();
    if (!vs.length) return null;
    const t = this.theme.tokens();
    const c = ac6Colors(this.theme.mode());
    const sel = this.store.versionName();
    const lbl = this.labels();
    const b = this.basis();
    return {
      aria: ariaDecal(),
      animationDurationUpdate: 500,
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: (ps: { dataIndex: number }[]) => {
          const [v, e] = vs[ps[0].dataIndex];
          let html = ttHead(v);
          for (const k of KOSTEN_ORDER) {
            const x = e.codes.get(k);
            if (x) html += ttRow(c.kosten[k], lbl.get(k) ?? String(k), `${pct(x / e.total, 1)} (${b === 'elemente' ? num(x) : hours(x, 0)})`);
          }
          return html + (e.ohne ? ttRow(null, 'Kostenstelle ohne Kostenstelle', num(e.ohne)) : '');
        },
      },
      grid: { left: 8, right: 12, top: 4, bottom: 8, outerBounds: { left: 8, right: 12, top: 4, bottom: 8 } },
      xAxis: { type: 'value', max: 1, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (v: number) => pct(v) } },
      yAxis: {
        type: 'category', data: vs.map(([v]) => v), axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: t.ink2, width: 230, overflow: 'truncate', fontSize: 11.5, formatter: (v: string) => (v === sel ? `{s|${v}}` : v),
          rich: { s: { color: t.ink, fontWeight: 700, fontSize: 11.5 } } },
      },
      series: KOSTEN_ORDER.filter((k) => lbl.has(k)).map((k) => ({
        name: lbl.get(k), type: 'bar', stack: 'k', barMaxWidth: 16, cursor: 'pointer',
        itemStyle: { color: c.kosten[k], borderColor: t.surface, borderWidth: 2, decal: k === 1 ? (this.theme.mode() === 'dark' ? HATCH_DARK : HATCH) : undefined },
        data: vs.map(([v, e]) => ({ value: e.total ? (e.codes.get(k) ?? 0) / e.total : 0, itemStyle: { opacity: v === sel ? 1 : 0.8 } })),
      })),
    };
  });

  protected click(e: { dataIndex?: number }): void {
    if (e?.dataIndex == null) return;
    const v = [...this.byVersion()].reverse()[e.dataIndex]?.[0];
    const r = this.store.rankOf('version', v);
    if (r != null) this.store.pickVersion(r);
  }
}
