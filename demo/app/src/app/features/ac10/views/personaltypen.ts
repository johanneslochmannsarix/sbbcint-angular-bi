import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ChartResize } from '../../../shared/chart-resize';
import { ThemeService } from '../../../core/theme';
import { num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac10Store } from '../data/store';
import { landHue, landOfMandant } from '../data/palette';

/**
 * View 4 - Welcher Haupt-Personaltyp fehlt, in welchem Mandanten? One bar per Haupt-Personaltyp, stacked by
 * Mandant (Land hue), length = [Anzahl ungeplante Schichten] in the window. «⇄ n» marks a Haupttyp that dim_scope
 * carries under n Mandanten (R6: allowed for a Personaltyp, never for a Depot). Haupttypen without any shift in
 * the window are folded into one count, not dropped silently. Click a bar: filter by that Haupttyp.
 */
@Component({
  selector: 'ac10-personaltypen',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Welcher Personaltyp fehlt wo?" [sub]="sub()" [q]="store.personaltypen">
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))" role="img" aria-label="Ungeplante Schichten je Haupt-Personaltyp und Mandant"></div>
      <p class="chart-note">⇄ = Haupt-Personaltyp kommt in mehreren Mandanten vor (zulässig; ein Depot gehört dagegen immer zu einem Mandanten).
        @if (folded()) { {{ folded() }} Haupttypen ohne Schicht im Zeitraum sind nicht als Balken gezeigt. }</p>
    </app-card>
  `,
})
export class PersonaltypenView {
  protected readonly store = inject(Ac10Store);
  protected readonly theme = inject(ThemeService);

  private readonly types = computed(() => {
    const by = new Map<string, { name: string; open: number; shifts: number; mandanten: number }>();
    for (const r of this.store.personaltypen.rows()) {
      const e = by.get(r.haupttyp_name) ?? { name: r.haupttyp_name, open: 0, shifts: 0, mandanten: r.mandanten_des_typs ?? 1 };
      e.open += r.ungeplant ?? 0;
      e.shifts += r.schichten ?? 0;
      by.set(r.haupttyp_name, e);
    }
    return [...by.values()];
  });
  /** layout order only: most open first */
  private readonly shown = computed(() => this.types().filter((x) => x.shifts > 0).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, 'de')));
  protected readonly folded = computed(() => this.types().length - this.shown().length);
  protected readonly height = computed(() => Math.max(160, this.shown().length * 26 + 74));
  protected readonly sub = computed(() => {
    const cross = this.shown().filter((x) => x.mandanten > 1).length;
    return `${this.shown().length} Haupt-Personaltypen mit Schichten im Zeitraum, ${cross} davon mandantenübergreifend. Klick filtert alles auf den Typ.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const types = this.shown();
    if (!types.length) return null;
    const t = this.theme.tokens();
    const rows = this.store.personaltypen.rows();
    const mandanten = [...new Set(rows.filter((r) => (r.schichten ?? 0) > 0).map((r) => r.tenant_name))]
      .sort((a, b) => (a.startsWith('(') ? 1 : 0) - (b.startsWith('(') ? 1 : 0) || a.localeCompare(b, 'de'));
    const sel = this.store.haupttyp();
    const cats = types.map((x) => x.name);
    return {
      aria: ariaDecal(),
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: t.ink2 } },
      grid: { left: 4, right: 48, top: 54, bottom: 4, outerBounds: { left: 4, right: 48, top: 54, bottom: 4 } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { seriesName: string; value: number; color: string; dataIndex: number }[]) => {
          const ty = types[ps[0].dataIndex];
          return ttHead(ty.name) + (ty.mandanten > 1 ? `<div style="color:${t.muted};margin:-2px 0 4px">in ${ty.mandanten} Mandanten</div>` : '') +
            ps.filter((p) => p.value > 0).map((p) => ttRow(p.color, p.seriesName, num(p.value))).join('') +
            ttRow(null, 'Schichten insgesamt', num(ty.shifts));
        },
      },
      xAxis: { type: 'value', axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } } },
      yAxis: {
        type: 'category', data: cats, inverse: true, axisTick: { show: false },
        axisLabel: {
          width: 230, overflow: 'truncate', fontSize: 11.5,
          formatter: (n: string) => {
            const ty = types[cats.indexOf(n)];
            const mark = ty.mandanten > 1 ? ` {x|⇄ ${ty.mandanten}}` : '';
            return `{${n === sel ? 's' : 'n'}|${esc(n)}}${mark}`;
          },
          rich: { n: { color: t.ink2, fontSize: 11.5 }, s: { color: t.ink, fontWeight: 600, fontSize: 11.5 }, x: { color: t.muted, fontSize: 11 } },
        },
      },
      series: mandanten.map((m, i) => ({
        name: m, type: 'bar', stack: 'm', barWidth: 14,
        itemStyle: { color: landHue(t, landOfMandant(m)), borderColor: t.surface, borderWidth: 1,
          borderRadius: i === mandanten.length - 1 ? [0, 3, 3, 0] : 0 },
        label: i === mandanten.length - 1 ? { show: true, position: 'right', color: t.ink2, fontSize: 11,
          formatter: (p: { dataIndex: number }) => num(types[p.dataIndex].open) } : undefined,
        data: types.map((ty) => rows.find((r) => r.tenant_name === m && r.haupttyp_name === ty.name)?.ungeplant ?? 0),
      })),
    };
  });

  protected click(e: { name?: string; componentType?: string }): void {
    if (e.componentType !== 'series' || !e.name) return;
    this.store.setHaupttyp(this.store.haupttyp() === e.name ? null : e.name);
  }
}
