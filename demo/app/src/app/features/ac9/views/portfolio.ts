import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { MergeOptions } from '../../../shared/merge-options';
import { NUM_FONT, ac9Colors, gaColor } from '../data/palette';
import { Ac9Store } from '../data/store';
import { AuftragRow, GA_CODE, GA_LABEL, katOf } from '../data/types';
import { RuleNote } from './rule-note';

const TOP = 22;

/**
 * View 2 - the portfolio. Rings Geschäftsart -> order category (SBB-CD Dienstleistung only; AÜ and the other DL
 * orders have none) -> order (token), area = billable hours of the selected months. «Rangliste» morphs the
 * orders into a ranked bar list (universalTransition keyed by the order token, AC-6's recipe: mergeOptions +
 * replaceMerge, one fixed height) with the concentration curve beside it in its own grid: the running share of
 * the hours down the ranking (a running sum of the returned per-order measure, layout only). A click on an order
 * opens it, on a ring segment filters the page.
 */
@Component({
  selector: 'ac9-portfolio',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, MergeOptions, RuleNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Welche Aufträge tragen die abrechenbaren Stunden?" [q]="store.auftraege" emptyNote="In dieser Auswahl hat kein Auftrag eine zurückgemeldete Tour.">
      <div card-tools>
        <div class="seg seg-sm" role="group" aria-label="Darstellung">
          <button type="button" [attr.aria-pressed]="shape() === 'ring'" (click)="shape.set('ring')">Ringe</button>
          <button type="button" [attr.aria-pressed]="shape() === 'rang'" (click)="shape.set('rang')">Rangliste und Konzentration</button>
        </div>
      </div>
      <p class="ac9-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="470" [options]="blank" [mergeOptions]="options()" [replaceMerge]="replace" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))" aria-label="Aufträge nach abrechenbaren Stunden, gruppiert nach Geschäftsart und Kategorie; Auftrag anklicken öffnet ihn"></div>
      <ac9-rule [keys]="['kategorie', 'monat']">
        <p>Auftragsnamen erscheinen als Kennung T-…; Klartext nur in der lokalen Ansicht mit Klarnamen.</p>
      </ac9-rule>
    </app-card>
  `,
})
export class Portfolio {
  protected readonly store = inject(Ac9Store);
  protected readonly theme = inject(ThemeService);
  protected readonly shape = signal<'ring' | 'rang'>('ring');
  protected readonly blank: EChartsCoreOption = {};
  /** the ranking has two grids (bars + concentration): replace axes and grids too, or the rings keep them */
  protected readonly replace = ['series', 'xAxis', 'yAxis', 'grid', 'graphic'];

  private readonly rows = computed(() => [...this.store.auftraege.rows()].filter((r) => r.auftrag_token).sort((a, b) => b.netto_h - a.netto_h));

  protected readonly answer = computed(() => {
    const rows = this.rows();
    if (!rows.length) return '';
    const total = rows.reduce((s, r) => s + r.netto_h, 0);
    const top10 = rows.slice(0, 10).reduce((s, r) => s + r.netto_h, 0);
    const top3 = rows.slice(0, 3).reduce((s, r) => s + r.netto_h, 0);
    const n = rows.length;
    if (n <= 3) return `${n} ${n === 1 ? 'Auftrag trägt' : 'Aufträge tragen'} die ${hours(total)} des ${this.store.rangeTextLong()}.`;
    return `${n} Aufträge haben zurückgemeldete Touren; die drei grössten tragen ${pct(top3 / total)} der ${hours(total)}, ` +
      `die zehn grössten ${pct(top10 / total)}.`;
  });

  private tip(r: AuftragRow): string {
    const c = ac9Colors(this.theme.mode());
    return ttHead(r.dor_name ?? '') + ttRow(gaColor(c, r.geschaeftsart), GA_LABEL[r.geschaeftsart ?? ''] ?? '–', '') +
      (r.kategorie_auftrag ? ttRow(null, 'Kategorie (Auftrag)', katOf(r.kategorie_auftrag).label) : '') +
      ttRow(null, 'abrechenbar', hours(r.netto_h)) + ttRow(null, 'Touren mit IST', num(r.touren)) +
      ttRow(null, 'Ø je Tour', hours(r.avg_h, 2)) + ttRow(null, 'Touren über 12 h', num(r.ue12)) +
      (r.abweichungen ? ttRow(null, 'Kategorie-Abweichungen', num(r.abweichungen)) : '');
  }

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac9Colors(this.theme.mode());
    const byTok = new Map(rows.map((r) => [r.auftrag_token!, r]));
    const sel = this.store.auftrag();
    const op = (tok: string) => (!sel || sel === tok ? 1 : 0.35);
    const common = {
      aria: ariaDecal(),
      animationDurationUpdate: 800,
      tooltip: {
        confine: true,
        formatter: (p: { data?: { id?: string; name?: string; value?: number; lvl?: string } }) => {
          const r = p.data?.id ? byTok.get(p.data.id) : null;
          if (r) return this.tip(r);
          return p.data?.lvl ? ttHead(p.data.name ?? '') + ttRow(null, 'abrechenbar', hours(Number(p.data.value))) : '';
        },
      },
    };
    if (this.shape() === 'ring') {
      const leaf = (r: AuftragRow, soft: string) => ({
        id: r.auftrag_token!, name: r.dor_name ?? '', value: r.netto_h,
        itemStyle: { color: soft, borderColor: t.surface, borderWidth: 1.5, opacity: op(r.auftrag_token!) },
      });
      const data = (['AÜ', 'DL'] as const).map((ga) => {
        const rs = rows.filter((r) => r.geschaeftsart === ga);
        const soft = ga === 'AÜ' ? c.aueSoft : c.dlSoft;
        // one category ring for both: AÜ (and DL outside SBB CD) sit under «ohne Kategorie», so the rings align
        const children = [...new Set(rs.map((r) => r.kategorie_auftrag ?? ''))].map((k) => {
          const kr = rs.filter((r) => (r.kategorie_auftrag ?? '') === k);
          return {
            name: katOf(k || null).label, lvl: 'kat', kat: katOf(k || null).code, value: kr.reduce((s, r) => s + r.netto_h, 0),
            itemStyle: { color: gaColor(c, ga), opacity: 0.82, borderColor: t.surface, borderWidth: 1.5 }, children: kr.map((r) => leaf(r, soft)),
          };
        });
        return { name: ga, lvl: 'ga', value: rs.reduce((s, r) => s + r.netto_h, 0), itemStyle: { color: gaColor(c, ga) }, children };
      }).filter((d) => d.value > 0);
      return {
        ...common,
        xAxis: { show: false, type: 'value' }, yAxis: { show: false, type: 'category', data: [] }, grid: { left: 0, top: 0, width: 1, height: 1 },
        graphic: [],
        series: [{
          id: 'ac9-sun', type: 'sunburst', nodeClick: false, sort: undefined, radius: ['10%', '96%'], center: ['50%', '50%'],
          universalTransition: { enabled: true, seriesKey: 'ac9-auftraege' }, data, cursor: 'pointer',
          label: { fontSize: 11, minAngle: 8, overflow: 'truncate', fontFamily: NUM_FONT, color: '#ffffff' },
          levels: [{}, { r0: '10%', r: '27%', label: { rotate: 'tangential', fontSize: 13, fontWeight: 600 } },
            { r0: '27%', r: '45%', label: { rotate: 'tangential', minAngle: 14, fontSize: 11 } },
            { r0: '45%', r: '96%', label: { rotate: 'radial', minAngle: 5, color: t.ink, align: 'left' } }],
        }],
      };
    }
    const total = rows.reduce((s, r) => s + r.netto_h, 0);
    let run = 0;
    const cum = rows.map((r) => (run += r.netto_h) / (total || 1));
    const shown = rows.slice(0, TOP);
    const cats = shown.map((r) => r.dor_name ?? '').reverse();
    const cumShown = shown.map((_, i) => cum[i]).reverse();
    return {
      ...common,
      grid: [
        { left: 8, right: '30%', top: 6, bottom: 22, outerBounds: { left: 8, right: 8, top: 6, bottom: 22 } },
        { left: '74%', right: 16, top: 6, bottom: 22 },
      ],
      xAxis: [
        { gridIndex: 0, show: true, type: 'value', splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (v: number) => num(v) } },
        { gridIndex: 1, show: true, type: 'value', min: 0, max: 1, splitNumber: 2, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (v: number) => pct(v) } },
      ],
      yAxis: [
        { gridIndex: 0, show: true, type: 'category', data: cats, axisLabel: { color: t.ink2, width: 150, overflow: 'truncate' } },
        { gridIndex: 1, show: true, type: 'category', data: cats, axisLabel: { show: false } },
      ],
      series: [
        {
          id: 'ac9-rang', type: 'bar', xAxisIndex: 0, yAxisIndex: 0, universalTransition: { enabled: true, seriesKey: 'ac9-auftraege' },
          barMaxWidth: 14, cursor: 'pointer',
          data: [...shown].reverse().map((r) => ({
            id: r.auftrag_token!, name: r.dor_name ?? '', value: r.netto_h,
            itemStyle: { color: gaColor(c, r.geschaeftsart), borderRadius: [0, 4, 4, 0], opacity: op(r.auftrag_token!) },
          })),
          label: { show: true, position: 'right', color: t.ink2, fontFamily: NUM_FONT, fontSize: 11, formatter: (p: { value: number }) => hours(p.value, 0) },
        },
        {
          id: 'ac9-pareto', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: cumShown, symbol: 'circle', symbolSize: 5,
          lineStyle: { color: t.ink, width: 2 }, itemStyle: { color: t.ink, borderColor: t.surface, borderWidth: 2 },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: t.axis, type: 'solid' }, label: { color: t.muted, formatter: '80 %' }, data: [{ xAxis: 0.8 }] },
          tooltip: { formatter: (p: { dataIndex: number }) => ttHead('Kumulierter Anteil') + ttRow(null, `bis Rang ${shown.length - p.dataIndex}`, pct(cumShown[p.dataIndex], 1)) },
        },
      ],
      graphic: rows.length > TOP ? [{ type: 'text', left: 8, bottom: 2, style: { text: `${rows.length - TOP} kleinere Aufträge nicht gezeigt`, fill: t.muted, font: '11px sans-serif' } }] : [],
    };
  });

  protected click(e: { data?: { id?: string; lvl?: string; name?: string; kat?: string } }): void {
    const d = e?.data;
    if (!d) return;
    if (d.lvl === 'ga' && d.name) return this.store.setGa(GA_CODE[d.name] ?? null);
    if (d.lvl === 'kat' && d.kat) return this.store.setKat(d.kat as 'int');
    if (d.id) this.store.openAuftrag(this.store.auftrag() === d.id ? null : d.id);
  }

  protected readonly esc = esc;
}
