import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ChartResize } from '../../../shared/chart-resize';
import { ThemeService } from '../../../core/theme';
import { BLANK, dateShort, dayMs, num, today } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartGroup } from '../../../shared/connect';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac10Store } from '../data/store';
import { hatch, kategorieRank, kategorieStyle, landHue } from '../data/palette';

const WD = new Intl.DateTimeFormat('de-CH', { weekday: 'short' });

/**
 * View 5 - Schichtelemente ohne Schicht (tier 2, R2): [Anzahl offene Schichtelemente] per day, stacked by the
 * element's own activity type (fahren_kategorie), past days kept and shaded. Italien and Italien 2A are two
 * series (two positions per section) in the Italian hue, 2A hatched; the Basel link in the Swiss hue, hatched.
 * Tier 2 has no Mandant / Depot / Personaltyp: those filters do not apply here (said in the subtitle). The totals
 * are the model's three page-2 cards ([… (vergangen)] / [… (zukünftig)]). Click a series: filter that category.
 */
@Component({
  selector: 'ac10-elemente',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, ChartGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Welche Zugabschnitte hat noch keine Schicht?" [sub]="sub()" [q]="[store.elemente, store.fenster]">
      <dl card-tools class="ac10-mini">
        <div><dt>offen im Zeitraum</dt><dd>{{ tot().all }}</dd></div>
        <div><dt>davon vergangen</dt><dd>{{ tot().past }}</dd></div>
        <div><dt>ab heute</dt><dd>{{ tot().future }}</dd></div>
      </dl>
      <div echarts class="chart ac10-elemente-chart" [options]="options()!" [theme]="theme.echartsTheme()" chartGroup="ac10-days"
           (chartClick)="click($any($event))" role="img" aria-label="Offene Schichtelemente ohne Schicht je Tag und Kategorie"></div>
      <p class="chart-note">Ein Schichtelement ohne Schicht ist ein Zugabschnitt, der noch keiner Schicht zugeordnet ist. Kategorie = Aktivitätstyp aus SaxMS;
        «Fahren Italien» und «Fahren Italien 2A» sind zwei Positionen je Abschnitt. Vergangene bleiben sichtbar (Kundenwunsch).</p>
    </app-card>
  `,
})
export class ElementeView {
  protected readonly store = inject(Ac10Store);
  protected readonly theme = inject(ThemeService);

  protected readonly tot = computed(() => {
    const f = this.store.fenster.rows()[0];
    return f ? { all: num(f.elemente_offen), past: num(f.elemente_vergangen), future: num(f.elemente_zukuenftig) } : { all: BLANK, past: BLANK, future: BLANK };
  });
  protected readonly sub = computed(() => {
    const filtered = this.store.mandant() || this.store.depot() || this.store.haupttyp() || this.store.zwingend() !== 'alle';
    const k = this.store.kategorie();
    return `${k ? `Kategorie ${k}. ` : ''}Je Tag und Kategorie (gestapelt).${filtered ? ' Mandant-, Depot-, Personaltyp- und Zwingend-Filter gelten hier nicht: diese Elemente haben keine.' : ''}`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.store.elemente.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const kats = [...new Set(rows.map((r) => r.fahren_kategorie))].sort((a, b) => kategorieRank(a) - kategorieRank(b));
    const now = today();
    const from = dayMs(this.store.from())!;
    const to = dayMs(this.store.to())!;
    return {
      aria: ariaDecal(),
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: t.ink2 }, selectedMode: false },
      grid: { left: 4, right: 12, top: 52, bottom: 4, outerBounds: { left: 4, right: 12, top: 52, bottom: 4 } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { seriesName: string; value: [number, number]; color: string }[]) => {
          const d = ps[0].value[0];
          const sum = ps.reduce((s, p) => s + (p.value[1] ?? 0), 0);
          return ttHead(`${WD.format(d)} ${dateShort(d)}${d < now ? ' · vergangen' : ''}`) +
            ps.filter((p) => p.value[1] > 0).map((p) => ttRow(p.color, p.seriesName, num(p.value[1]))).join('') + ttRow(null, 'zusammen', num(sum));
        },
      },
      xAxis: { type: 'time', min: from - 43_200_000, max: to + 43_200_000, axisLabel: { formatter: (v: number) => dateShort(v), hideOverlap: true, color: t.muted } },
      yAxis: { type: 'value', axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } } },
      series: kats.map((k, i) => {
        const st = kategorieStyle(k);
        const hue = landHue(t, st.land);
        const dim = this.store.kategorie() && this.store.kategorie() !== k;
        return {
          name: k, type: 'bar', stack: 'k', barMaxWidth: 22,
          itemStyle: { color: hue, opacity: dim ? 0.25 : 1, borderColor: t.surface, borderWidth: 1, decal: st.hatch ? hatch('rgba(255,255,255,0.55)') : undefined,
            borderRadius: i === kats.length - 1 ? [3, 3, 0, 0] : 0 },
          data: rows.filter((r) => r.fahren_kategorie === k).map((r) => [dayMs(r.datum), r.offen]),
          markArea: i === 0 && from < now ? { silent: true, itemStyle: { color: t.grid, opacity: 0.5 },
            label: { show: true, position: 'insideTopLeft', formatter: 'vergangen', color: t.muted, fontSize: 11 },
            data: [[{ xAxis: from - 43_200_000 }, { xAxis: Math.min(now, to + 86_400_000) - 43_200_000 }]] } : undefined,
          markLine: i === 0 ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: t.ink, width: 1 }, data: [{ xAxis: now }] } : undefined,
        };
      }),
    };
  });

  protected click(e: { componentType?: string; seriesName?: string }): void {
    if (e.componentType !== 'series' || !e.seriesName) return;
    this.store.setKategorie(this.store.kategorie() === e.seriesName ? null : e.seriesName);
  }
}
