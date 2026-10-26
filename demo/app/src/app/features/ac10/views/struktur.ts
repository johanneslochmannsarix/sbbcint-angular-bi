import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ChartResize } from '../../../shared/chart-resize';
import { ThemeService } from '../../../core/theme';
import { num, pct } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { MergeOptions } from '../../../shared/merge-options';
import { ariaDecal, esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac10Store } from '../data/store';
import { ac10Colors, landHue, landOfMandant } from '../data/palette';
import { StrukturRow } from '../data/types';
import { UiOption, UiSeg } from '../../../shared/ui';

type Shape = 'struktur' | 'rangliste';

/** white or ink on a fill, whichever reads (WCAG relative luminance) */
function inkOn(hex: string, ink: string): string {
  const n = parseInt(hex.slice(1), 16);
  const l = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  return lum > 0.3 ? (ink.startsWith('#e') ? '#15212b' : ink) : '#ffffff';
}
const ID_SEP = '\u001f';

/**
 * View 2 - Wo ist es am schlimmsten? Treemap Mandant > Depot (area = [Anzahl ungeplante Schichten], hue = Land)
 * that morphs (universalTransition, same data ids) into a ranked bar list per depot, zwingend part dark, nicht
 * zwingend light. The Mandant totals are the model's own subtotal rows (struktur ebene = mandant), never summed
 * here. Zero-shift depots have no area in the treemap; the ranking lists them at 0 (R4). Click: pick the depot.
 */
@Component({
  selector: 'ac10-struktur',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, MergeOptions, UiSeg],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wo ist es am schlimmsten?"
              [sub]="sub()" [q]="store.struktur">
      <ui-seg card-tools size="sm" ariaLabel="Darstellung" [options]="shapeOptions" [value]="shape()" (valueChange)="shape.set($event)" />
      <div echarts class="chart ac10-struktur-chart" [options]="{}" [mergeOptions]="options()" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))" role="img" aria-label="Ungeplante Schichten je Mandant und Depot"></div>
      @if (mandanten().length) {
        <div class="ac10-legend ac10-legend-left">
          @for (m of mandanten(); track m.label) {
            <span><i class="key" [style.background]="m.color"></i>{{ m.label }} {{ m.value }}</span>
          }
        </div>
      }
    </app-card>
  `,
})
export class StrukturView {
  protected readonly store = inject(Ac10Store);
  protected readonly theme = inject(ThemeService);
  protected readonly shape = signal<Shape>('struktur');
  protected readonly shapeOptions: UiOption<Shape>[] = [
    { value: 'struktur', label: 'Struktur' },
    { value: 'rangliste', label: 'Rangliste' },
  ];

  private readonly depots = computed(() => this.store.struktur.rows().filter((r) => r.ebene === 'depot'));
  protected readonly mandanten = computed(() => {
    const t = this.theme.tokens();
    return this.store.struktur.rows().filter((r) => r.ebene === 'mandant' && !r.mandant.startsWith('('))
      .sort((a, b) => b.ungeplant - a.ungeplant)
      .map((r) => ({ label: r.mandant, value: num(r.ungeplant), color: landHue(t, landOfMandant(r.mandant)) }));
  });
  protected readonly sub = computed(() => {
    const n = this.depots().length;
    const zero = this.depots().filter((r) => r.schichten === 0).length;
    return this.shape() === 'struktur'
      ? 'Fläche = ungeplante Schichten im Zeitraum, Farbe = Land (Mandant). Klick wählt das Depot.'
      : `${n} Depots, ${zero} ohne geplante Schicht (bleiben sichtbar). Dunkel = zwingend, hell = nicht zwingend.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.struktur.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac10Colors(t);
    const selM = this.store.mandant();
    const selD = this.store.depot();
    const id = (r: StrukturRow) => `${r.mandant}${ID_SEP}${r.depot}`;
    const fade = (m: string) => (selM && m !== selM ? 0.3 : 1);
    const tip = (r: StrukturRow) => ttHead(r.depot ?? r.mandant) + `<div style="color:${t.muted};margin:-2px 0 4px">${esc(r.depot ? r.mandant : 'Mandant')}</div>` +
      ttRow(c.openStrong, 'Ungeplant zwingend', num(r.ungeplant_zwingend)) + ttRow(c.openSoft, 'Ungeplant nicht zwingend', num(r.ungeplant - r.ungeplant_zwingend)) +
      ttRow(null, 'Schichten insgesamt', num(r.schichten)) + ttRow(null, 'Besetzungsquote', pct(r.besetzungsquote, 1));
    const transition = { universalTransition: { enabled: true, divideShape: 'clone' } };
    if (this.shape() === 'struktur') {
      const mand = rows.filter((r) => r.ebene === 'mandant' && r.ungeplant > 0);
      const data = mand.map((m) => {
        const hue = landHue(t, landOfMandant(m.mandant));
        const ink = inkOn(hue, t.ink);
        return {
          name: m.mandant, value: m.ungeplant, row: m,
          label: { color: ink, rich: { b: { fontSize: 15, fontWeight: 600, color: ink, padding: [3, 0, 0, 0] } } },
          upperLabel: { color: ink },
          itemStyle: { color: hue, borderColor: t.surface, opacity: fade(m.mandant) },
          children: this.depots().filter((d) => d.mandant === m.mandant && d.ungeplant > 0).map((d) => ({
            id: id(d), name: d.depot, value: d.ungeplant, row: d,
            label: { color: ink, rich: { b: { fontSize: 15, fontWeight: 600, color: ink, padding: [3, 0, 0, 0] } } },
            itemStyle: { color: hue, opacity: fade(d.mandant), borderColor: selD === d.depot && selM === d.mandant ? t.ink : t.surface,
              borderWidth: selD === d.depot && selM === d.mandant ? 3 : 2 },
          })),
        };
      });
      return {
        aria: ariaDecal(),
        tooltip: { confine: true, formatter: (p: { data?: { row?: StrukturRow } }) => (p.data?.row ? tip(p.data.row) : '') },
        xAxis: { show: false }, yAxis: { show: false },
        series: [{
          id: 'struktur-treemap', type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
          left: 0, right: 0, top: 0, bottom: 0, squareRatio: 0.9, data, ...transition,
          upperLabel: { show: true, height: 20, color: '#fff', fontWeight: 600, fontSize: 12,
            formatter: (p: { name: string; value: number }) => `${p.name}  ${num(p.value)}` },
          label: { show: true, color: '#fff', fontSize: 11.5, overflow: 'truncate',
            formatter: (p: { name: string; value: number }) => `${p.name}\n{b|${num(p.value)}}`, rich: { b: { fontSize: 15, fontWeight: 600, color: '#fff', padding: [3, 0, 0, 0] } } },
          levels: [
            // level 0 = the invisible root: no fill, no upper label (it drew a white strip in dark mode)
            { itemStyle: { borderWidth: 0, gapWidth: 3, color: 'transparent' }, upperLabel: { show: false } },
            { itemStyle: { gapWidth: 2, borderWidth: 2 }, upperLabel: { show: true } },
            { itemStyle: { gapWidth: 1 } },
          ],
        }],
      };
    }
    const list = this.depots().filter((d) => !selM || d.mandant === selM)
      .sort((a, b) => b.ungeplant - a.ungeplant || b.schichten - a.schichten || (a.depot ?? '').localeCompare(b.depot ?? '', 'de'));
    const cats = list.map(id);
    const label = (r: StrukturRow) => `${r.depot}`;
    return {
      aria: ariaDecal(),
      grid: { left: 4, right: 40, top: 4, bottom: 4, outerBounds: { left: 4, right: 40, top: 4, bottom: 4 } },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { dataIndex: number }[]) => tip(list[ps[0].dataIndex]) },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category', data: cats, inverse: true, axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { formatter: (k: string) => label(list[cats.indexOf(k)]), color: t.ink2, fontSize: 11.5, width: 150, overflow: 'truncate' },
      },
      series: [
        { id: 'rang-zw', type: 'bar', stack: 'u', barWidth: 12, ...transition,
          data: list.map((r) => ({ id: id(r), value: r.ungeplant_zwingend, row: r,
            itemStyle: { color: c.openStrong, borderColor: selD === r.depot && selM === r.mandant ? t.ink : undefined, borderWidth: selD === r.depot && selM === r.mandant ? 1.5 : 0 } })) },
        { id: 'rang-nzw', type: 'bar', stack: 'u', barWidth: 12,
          itemStyle: { color: c.openSoft, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: { dataIndex: number }) => num(list[p.dataIndex].ungeplant) },
          data: list.map((r) => ({ value: r.ungeplant - r.ungeplant_zwingend, row: r })) },
      ],
    };
  });

  protected click(e: { data?: { row?: StrukturRow } }): void {
    const r = e.data?.row;
    if (!r) return;
    if (r.ebene === 'mandant' || !r.depot) this.store.pickMandant(this.store.mandant() === r.mandant ? null : r.mandant);
    else this.store.pickDepot(r.mandant, r.depot);
  }
}
