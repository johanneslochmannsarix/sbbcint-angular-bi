import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { MergeOptions } from '../../../shared/merge-options';
import { ac4Colors } from '../data/palette';
import { Ac4Store, FOCUS_LABEL, Focus, monthLabel } from '../data/store';
import { StandortRow } from '../data/types';

function focusValue(r: StandortRow, f: Focus): number | null {
  if (f === 'anger_fill') return r.touren ? (r.touren_anger ?? 0) / r.touren : null;
  return r[f] ?? null;
}
function focusText(v: number | null, f: Focus): string {
  return f === 'plandauer_touren_h' ? hours(v, 0) : pct(v, 1);
}

/**
 * View 1 - Produktivität. A treemap Firma -> Tourstandort (area = Plandauer der Touren, colour = the focused
 * KPI, bucketed into the single-hue Stahlblau ramp) that switches into a ranking of the Tourstandorte by that KPI.
 * The ranking animates between KPIs (bars keyed by depot_sk). A universalTransition morph treemap -> bar was
 * tried (same id, and one id per shape paired by seriesKey): echarts 6.1 left the treemap leaves stuck on the
 * canvas both ways (screenshot 2026-10-21), so the treemap side has it switched off. Clicking a company zooms to it (Firma
 * filter), clicking a Tourstandort drills to it (Tourstandort filter; the ranking marks it and the tour list
 * opens). Answers «which Tourstandorte carry the volume, at which Fahranteil, with how much Ist?»
 */
@Component({
  selector: 'ac4-overview',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, MergeOptions],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Welche Tourstandorte tragen das Volumen?" [q]="store.standorte" emptyNote="Unter diesem Filter hat kein Tourstandort Touren.">
      <div card-tools class="ac4-tools">
        <div class="seg seg-sm" role="group" aria-label="Darstellung">
          <button type="button" [attr.aria-pressed]="shape() === 'treemap'" (click)="mode.set('treemap')">Fläche</button>
          <button type="button" [attr.aria-pressed]="shape() === 'ranking'" (click)="mode.set('ranking')">Rangliste</button>
        </div>
      </div>
      <p class="ac4-answer">{{ answer() }}</p>
      <div echarts class="chart" [style.height.px]="height()" [options]="{}" [mergeOptions]="options()" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))"></div>
      <div class="ac4-scale" aria-label="Farbskala">
        <span>Farbe: {{ focusLabel() }}</span>
        <span class="ac4-scale-ramp">
          @for (s of ramp(); track $index) { <i [style.background]="s"></i> }
        </span>
        <span>{{ rangeText() }}</span>
        <span class="muted">Fläche: Plandauer der Touren · Farbe über die KPI-Kacheln wählen</span>
      </div>
      <p class="ac4-cover">Firma ist die Firma des Tourstandorts (seit cc 1.35.0), nicht der Mandant des Tourelements. Personen und damit «Anteil Person eingeteilt» fehlen bei SBB Cargo Deutschland bewusst (SAX-30).</p>
    </app-card>
  `,
})
export class OverviewView {
  protected readonly store = inject(Ac4Store);
  protected readonly theme = inject(ThemeService);
  protected readonly mode = signal<'treemap' | 'ranking'>('treemap');

  /** a picked Tourstandort always shows the ranking (where it sits among the others) */
  protected readonly shape = computed(() => (this.store.standort() ? 'ranking' : this.mode()));
  protected readonly focusLabel = computed(() => FOCUS_LABEL[this.store.focus()]);

  private readonly rows = computed(() => {
    const f = this.store.firma();
    return this.store.standorte.rows().filter((r) => r.depot_sk && (r.touren ?? 0) > 0 && (!f || r.firma === f));
  });
  private readonly extent = computed(() => {
    const f = this.store.focus();
    const vs = this.rows().map((r) => focusValue(r, f)).filter((v): v is number => v != null && Number.isFinite(v));
    return vs.length ? [Math.min(...vs), Math.max(...vs)] : [0, 1];
  });
  protected readonly ramp = computed(() => ac4Colors(this.theme.mode()).seq.slice(1));
  protected readonly rangeText = computed(() => {
    const [a, b] = this.extent();
    const f = this.store.focus();
    return `${focusText(a, f)} – ${focusText(b, f)}`;
  });

  /** colour bucketing of the focused KPI (layout only): 6 equal steps over the shown extent */
  private colorOf(v: number | null): string {
    const ramp = this.ramp();
    if (v == null || !Number.isFinite(v)) return ac4Colors(this.theme.mode()).neutral;
    const [a, b] = this.extent();
    const i = b > a ? Math.min(ramp.length - 1, Math.floor(((v - a) / (b - a)) * ramp.length)) : ramp.length - 1;
    return ramp[i];
  }

  /** label ink on a ramp cell: dark text on the light half in light mode, light text otherwise (contrast) */
  private inkOn(v: number | null): string {
    const ramp = this.ramp();
    const cell = this.colorOf(v);
    const i = ramp.indexOf(cell);
    if (this.theme.mode() === 'dark') return i >= 0 && i >= ramp.length - 1 ? '#0e1316' : '#ffffff';
    return i >= 0 && i < 3 ? '#15212b' : '#ffffff';
  }

  protected readonly height = computed(() => (this.shape() === 'ranking' ? Math.max(260, this.rows().length * 22 + 40) : 420));

  protected readonly answer = computed(() => {
    const rows = this.rows();
    if (!rows.length) return '';
    const total = rows.reduce((s, r) => s + (r.plandauer_touren_h ?? 0), 0);
    const m = monthLabel(this.store.month());
    const sk = this.store.standort();
    const pick = sk ? rows.find((r) => r.depot_sk === sk) : null;
    if (pick) {
      const f = this.store.focus();
      const order = [...rows].sort((a, b) => (focusValue(b, f) ?? -1) - (focusValue(a, f) ?? -1));
      return `${pick.tourstandort} plant ${hours(pick.plandauer_touren_h, 0)} in ${num(pick.touren)} Touren (${m}), ${pct(total ? (pick.plandauer_touren_h ?? 0) / total : null, 1)} der Auswahl; ` +
        `Rang ${order.indexOf(pick) + 1} von ${rows.length} nach ${FOCUS_LABEL[f]} (${focusText(focusValue(pick, f), f)}).`;
    }
    const top = [...rows].sort((a, b) => (b.plandauer_touren_h ?? 0) - (a.plandauer_touren_h ?? 0)).slice(0, 3);
    const share = top.reduce((s, r) => s + (r.plandauer_touren_h ?? 0), 0) / (total || 1);
    return `${top.map((r) => r.tourstandort).join(', ')} tragen ${pct(share)} der Plandauer (${m}, ${rows.length} Tourstandorte${this.store.firma() ? ` von ${this.store.firma()}` : ''}).`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const rows = this.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac4Colors(this.theme.mode());
    const f = this.store.focus();
    const sel = this.store.standort();
    const tip = (r: StandortRow) => ttHead(`${r.tourstandort ?? ''} · ${r.firma ?? ''}`) +
      ttRow(null, 'Touren', num(r.touren)) + ttRow(null, 'Plandauer Touren', hours(r.plandauer_touren_h, 0)) +
      ttRow(null, 'Ø Dauer je Tour', hours(r.dauer_je_tour_h, 2)) + ttRow(c.fahren, 'Fahranteil', pct(r.fahranteil, 1)) +
      ttRow(c.ist, 'Ist-Erfassungsgrad', pct(r.ist_erfassung, 1)) + ttRow(null, 'Person eingeteilt', pct(r.anteil_person, 1)) +
      ttRow(null, 'Touren mit angerechneter Zeit', `${num(r.touren_anger)} (${pct(r.touren ? (r.touren_anger ?? 0) / r.touren : null)})`);
    const byId = new Map(rows.map((r) => [r.depot_sk!, r]));
    const common = {
      animationDurationUpdate: 700,
      aria: ariaDecal(),
      tooltip: {
        confine: true,
        formatter: (p: { data?: { id?: string; firma?: boolean; name?: string; value?: number | number[] } }) => {
          const r = p.data?.id ? byId.get(p.data.id) : null;
          if (r) return tip(r);
          return p.data?.firma ? ttHead(p.data.name ?? '') + ttRow(null, 'Plandauer Touren', hours(Array.isArray(p.data.value) ? p.data.value[0] : p.data.value, 0)) : '';
        },
      },
    };
    if (this.shape() === 'treemap') {
      const firms = new Map<string, StandortRow[]>();
      for (const r of rows) (firms.get(r.firma ?? '–') ?? firms.set(r.firma ?? '–', []).get(r.firma ?? '–')!).push(r);
      const data = [...firms].map(([firma, rs]) => ({
        name: firma, firma: true,
        value: rs.reduce((s, r) => s + (r.plandauer_touren_h ?? 0), 0),
        children: rs.map((r) => ({
          id: r.depot_sk!, name: r.tourstandort ?? '', value: r.plandauer_touren_h ?? 0,
          itemStyle: { color: this.colorOf(focusValue(r, f)) },
          label: {
            color: this.inkOn(focusValue(r, f)),
            formatter: () => `${r.tourstandort}\n{v|${focusText(focusValue(r, f), f)}}`,
            rich: { v: { fontFamily: 'Bahnschrift, sans-serif', fontSize: 15, fontWeight: 600, color: this.inkOn(focusValue(r, f)), padding: [3, 0, 0, 0] } },
          },
        })),
      }));
      return {
        ...common,
        xAxis: { show: false, type: 'value' }, yAxis: { show: false, type: 'category', data: [] },
        grid: { left: 0, right: 0, top: 0, bottom: 0 },
        series: [{
          id: 'ac4-treemap', type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
          left: 0, right: 0, top: 4, bottom: 0, data, universalTransition: { enabled: false },
          upperLabel: { show: true, height: 22, color: t.ink, fontWeight: 600, fontFamily: 'Constantia, Georgia, serif' },
          label: { color: '#fff', fontSize: 12, lineHeight: 15, overflow: 'truncate', rich: { v: { fontFamily: 'Bahnschrift, sans-serif', fontSize: 15, fontWeight: 600, color: '#fff', padding: [3, 0, 0, 0] } } },
          levels: [
            { itemStyle: { borderColor: t.surface, borderWidth: 0, gapWidth: 3 } },
            { color: [t.grid], itemStyle: { borderColor: t.surface, borderWidth: 3, gapWidth: 2 }, upperLabel: { show: true } },
            { itemStyle: { borderColor: t.surface, borderWidth: 1, gapWidth: 0 } },
          ],
          cursor: 'pointer',
        }],
      };
    }
    const order = [...rows].sort((a, b) => (focusValue(a, f) ?? -1) - (focusValue(b, f) ?? -1));
    return {
      ...common,
      grid: { left: 8, right: 64, top: 8, bottom: 8, outerBounds: { left: 8, right: 64, top: 8, bottom: 8 } },
      xAxis: { show: true, type: 'value', splitLine: { lineStyle: { color: t.grid } }, axisLabel: { formatter: (v: number) => (f === 'plandauer_touren_h' ? num(v) : pct(v)) } },
      yAxis: { show: true, type: 'category', data: order.map((r) => r.tourstandort), axisLabel: { color: t.ink2, width: 170, overflow: 'truncate' } },
      series: [{
        id: 'ac4-ranking', type: 'bar', universalTransition: { enabled: true, seriesKey: 'ac4-standorte' }, barMaxWidth: 16, cursor: 'pointer',
        data: order.map((r) => ({
          id: r.depot_sk!, name: r.tourstandort ?? '', value: focusValue(r, f),
          itemStyle: { color: this.colorOf(focusValue(r, f)), opacity: !sel || sel === r.depot_sk ? 1 : 0.35, borderRadius: [0, 4, 4, 0],
            borderColor: sel === r.depot_sk ? t.ink : 'transparent', borderWidth: sel === r.depot_sk ? 1.5 : 0 },
        })),
        label: { show: true, position: 'right', color: t.ink2, fontFamily: 'Bahnschrift, sans-serif', formatter: (p: { value: number }) => focusText(p.value, f) },
      }],
    };
  });

  protected click(e: { data?: { id?: string; firma?: boolean; name?: string } }): void {
    const d = e?.data;
    if (!d) return;
    if (d.firma) {
      this.store.pickFirma(this.store.firma() === d.name ? null : (d.name ?? null));
      return;
    }
    if (d.id) this.store.pickStandort(this.store.standort() === d.id ? null : d.id);
  }
}
