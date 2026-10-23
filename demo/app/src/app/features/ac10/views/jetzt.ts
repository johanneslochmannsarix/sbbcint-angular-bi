import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ChartResize } from '../../../shared/chart-resize';
import { ThemeService } from '../../../core/theme';
import { BLANK, addDays, dateShort, dayMs, isoDay, num, pct, today } from '../../../core/format';
import { ChartGroup } from '../../../shared/connect';
import { ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac10Store } from '../data/store';
import { ac10Colors } from '../data/palette';
import { TageRow } from '../data/types';

const WD = new Intl.DateTimeFormat('de-CH', { weekday: 'long' });

type TileKey = 'heute' | 'morgen' | 'woche' | 'fenster' | 'elemente';
interface Tile {
  key: TileKey;
  label: string;
  when: string;
  value: string;
  zw: number | null;
  open: number | null;
  sub: string;
  action: string;
  active: boolean;
  spark: EChartsCoreOption | null;
}

/**
 * View 0 - «Jetzt»: the first thing a dispatcher reads. Heute / Morgen / next 7 days come from `jetzt` (one row,
 * the browser's today), «Im Zeitraum» and the element count from `fenster`. The split bar under each number is
 * the model's zwingend part against the rest, not a computed share. Sparklines: `tage` over the chosen window,
 * connected (hover one day, see it in every tile). Click: a day tile drills that day, «7 Tage» sets the window,
 * «Schichtelemente» jumps to view 5.
 */
@Component({
  selector: 'ac10-jetzt',
  imports: [NgxEchartsDirective, ChartResize, ChartGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './jetzt.css',
  host: { class: 'ac10-jetzt', role: 'group', 'aria-label': 'Jetzt: ungeplante Schichten' },
  template: `
    @for (t of tiles(); track t.key) {
      <button type="button" class="ac10-tile" [class.is-active]="t.active" [class.is-el]="t.key === 'elemente'"
              [attr.aria-pressed]="t.active" (click)="pick(t.key)" [title]="t.action">
        <span class="ac10-tile-label">{{ t.label }} <span class="ac10-tile-when">{{ t.when }}</span></span>
        <span class="ac10-tile-value">{{ t.value }}</span>
        @if (t.open != null && t.zw != null) {
          <span class="ac10-split" aria-hidden="true">
            <i class="ac10-split-zw" [style.flex-grow]="t.zw"></i><i class="ac10-split-nzw" [style.flex-grow]="t.open - t.zw"></i>
          </span>
        }
        <span class="ac10-tile-sub">{{ t.sub }}</span>
        <div echarts class="ac10-spark" [options]="t.spark!" [theme]="theme.echartsTheme()" chartGroup="ac10-days"></div>
      </button>
    }
  `,
})
export class JetztView {
  protected readonly store = inject(Ac10Store);
  protected readonly theme = inject(ThemeService);
  readonly jump = output<'elemente' | 'drill' | 'heatmap'>();

  private spark(rows: TageRow[], key: 'ungeplant' | 'elemente_offen', mark: [number, number] | null): EChartsCoreOption | null {
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = ac10Colors(t);
    const color = key === 'ungeplant' ? c.open : t.ink2;
    const now = today();
    return {
      animationDuration: 300,
      grid: { left: 0, right: 0, top: 3, bottom: 0 },
      xAxis: { type: 'time', show: false, min: dayMs(this.store.from())! - 43_200_000, max: dayMs(this.store.to())! + 43_200_000 },
      yAxis: { type: 'value', show: false, min: 0 },
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'line', lineStyle: { color: t.axis } },
        formatter: (ps: { value: [number, number] }[]) => ttHead(dateShort(ps[0].value[0])) +
          ttRow(color, key === 'ungeplant' ? 'Ungeplante Schichten' : 'Schichtelemente ohne Schicht', num(ps[0].value[1])),
      },
      series: [{
        type: 'line', step: 'middle', showSymbol: false, lineStyle: { width: 1.5, color }, areaStyle: { color, opacity: 0.12 },
        data: rows.map((r) => [dayMs(r.datum), r[key]]),
        markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: t.ink, width: 1, type: 'dotted' }, data: [{ xAxis: now }] },
        markArea: mark ? { silent: true, itemStyle: { color: t.seq[0], opacity: 0.55 }, data: [[{ xAxis: mark[0] - 43_200_000 }, { xAxis: mark[1] + 43_200_000 }]] } : undefined,
      }],
    };
  }

  protected readonly tiles = computed<Tile[]>(() => {
    const j = this.store.jetzt.rows()[0];
    const f = this.store.fenster.rows()[0];
    const days = this.store.tage.rows();
    const t0 = today();
    const t1 = addDays(t0, 1);
    const t6 = addDays(t0, 6);
    const drilled = this.store.tag();
    const isWeek = this.store.from() === isoDay(t0) && this.store.to() === isoDay(t6);
    const zwText = (zw: number | undefined, open: number | undefined, tot: number | undefined) =>
      open == null ? '' : `davon ${num(zw)} zwingend · von ${num(tot)} Schichten`;
    return [
      { key: 'heute', label: 'Heute', when: `${WD.format(t0)} ${dateShort(t0)}`, value: j ? num(j.heute_ungeplant) : BLANK,
        zw: j?.heute_zwingend ?? null, open: j?.heute_ungeplant ?? null, sub: zwText(j?.heute_zwingend, j?.heute_ungeplant, j?.heute_schichten),
        action: 'Den heutigen Tag im Tagesdrill öffnen', active: drilled === isoDay(t0), spark: this.spark(days, 'ungeplant', [t0, t0]) },
      { key: 'morgen', label: 'Morgen', when: `${WD.format(t1)} ${dateShort(t1)}`, value: j ? num(j.morgen_ungeplant) : BLANK,
        zw: j?.morgen_zwingend ?? null, open: j?.morgen_ungeplant ?? null, sub: zwText(j?.morgen_zwingend, j?.morgen_ungeplant, j?.morgen_schichten),
        action: 'Morgen im Tagesdrill öffnen', active: drilled === isoDay(t1), spark: this.spark(days, 'ungeplant', [t1, t1]) },
      { key: 'woche', label: 'Nächste 7 Tage', when: `${dateShort(t0)} – ${dateShort(t6)}`, value: j ? num(j.woche_ungeplant) : BLANK,
        zw: j?.woche_zwingend ?? null, open: j?.woche_ungeplant ?? null, sub: zwText(j?.woche_zwingend, j?.woche_ungeplant, j?.woche_schichten),
        action: 'Zeitraum auf heute bis +6 Tage setzen', active: isWeek, spark: this.spark(days, 'ungeplant', [t0, t6]) },
      { key: 'fenster', label: 'Im Zeitraum', when: `${dateShort(dayMs(this.store.from())!)} – ${dateShort(dayMs(this.store.to())!)}`,
        value: f ? num(f.ungeplant) : BLANK, zw: f?.ungeplant_zwingend ?? null, open: f?.ungeplant ?? null,
        sub: f ? `davon ${num(f.ungeplant_zwingend)} zwingend · Besetzungsquote ${pct(f.besetzungsquote, 1)}` : '',
        action: 'Zur Belegungstafel', active: false, spark: this.spark(days, 'ungeplant', null) },
      { key: 'elemente', label: 'Schichtelemente ohne Schicht', when: 'heute', value: j ? num(j.heute_elemente) : BLANK,
        zw: null, open: null, sub: j && f ? `${num(j.woche_elemente)} in 7 Tagen · ${num(f.elemente_offen)} im Zeitraum` : '',
        action: 'Zu den Schichtelementen ohne Schicht', active: false, spark: this.spark(days, 'elemente_offen', [t0, t0]) },
    ];
  });

  protected pick(k: TileKey): void {
    const t0 = today();
    if (k === 'heute' || k === 'morgen') {
      const d = isoDay(k === 'heute' ? t0 : addDays(t0, 1));
      this.store.pickDay(this.store.tag() === d ? null : d);
      this.jump.emit('drill');
    } else if (k === 'woche') {
      this.store.setWindow(isoDay(t0), isoDay(addDays(t0, 6)));
    } else if (k === 'fenster') {
      this.jump.emit('heatmap');
    } else {
      this.jump.emit('elemente');
    }
  }
}
