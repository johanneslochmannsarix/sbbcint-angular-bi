import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, hours, monthShort, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartGroup } from '../../../shared/connect';
import { ttHead, ttRow } from '../../../shared/chart-opts';
import { ac13Colors } from '../data/palette';
import { Ac13Store, Focus } from '../data/store';
import { MonatRow } from '../data/types';

interface TileDef {
  focus: Focus;
  label: string;
  value: (r: MonatRow) => number;
  show: (r: MonatRow) => string;
  sub: (r: MonatRow) => string;
  color: 'tour' | 'az' | 'ue' | 'anger' | 'verkauft' | 'ruhe';
}

const share = (a: number, b: number) => (b ? a / b : null);

const TILES: TileDef[] = [
  { focus: 'touren', label: 'Touren', value: (r) => r.touren, show: (r) => num(r.touren), color: 'tour',
    sub: (r) => `${num(r.besetzt)} besetzt, ${num(r.offen)} offen (${pct(share(r.offen, r.touren), 0)})` },
  { focus: 'az', label: 'Arbeitszeit v1', value: (r) => r.az_h, show: (r) => hours(r.az_h, 0), color: 'az',
    sub: (r) => `Plandauer ${hours(r.plan_h, 0)}` },
  { focus: 'ue', label: 'Übernachtungstouren', value: (r) => r.ue_touren, show: (r) => num(r.ue_touren), color: 'ue',
    sub: (r) => `beide Wege; ${num(r.paare)} Paare` },
  { focus: 'schwelle', label: 'Touren ≥ 12 h / ≥ 14 h', value: (r) => r.ge12, show: (r) => `${num(r.ge12)} / ${num(r.ge14)}`, color: 'anger',
    sub: (r) => `auf angerechneter Zeit; gefüllt bei ${pct(share(r.angerechnet_touren, r.touren), 0)} der Touren` },
  { focus: 'verkauft', label: 'Verkaufte Touren', value: (r) => r.verkauft, show: (r) => num(r.verkauft), color: 'verkauft',
    sub: (r) => `${num(r.schulungen)} Schulungen` },
  { focus: 'abwesend', label: 'Personentage mit Abwesenheit', value: (r) => r.familie + r.uebrige, show: (r) => num(r.familie + r.uebrige), color: 'ruhe',
    sub: (r) => `${num(r.familie)} Ruhe / Urlaub, ${num(r.uebrige)} übrige` },
];

const monthMs = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).getTime();

/**
 * View 0 - the month bar. Month picker (default = the model's «Vormonat», from its Zurich run day), then the KPI
 * band: the report's KPI measures for the shown month, each tile with its month profile. A click on a month
 * (button or sparkline bar) picks that month for every view; a click on a tile puts its subject in front (calendar
 * emphasis, heatmap measure, AZ axis). Sparklines share one echarts.connect group (tooltip on the same month).
 */
@Component({
  selector: 'ac13-month-bar',
  styleUrl: './month-bar.css',
  encapsulation: ViewEncapsulation.None,
  imports: [NgxEchartsDirective, ChartGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ac13-mbar' },
  template: `
    <div class="ac13-months" role="group" aria-label="Monat">
      @for (m of store.months(); track m.label) {
        <button type="button" class="ac13-month" [attr.aria-pressed]="m.label === store.month()" (click)="store.pickMonth(m.label)"
                [title]="m.label === store.vormonat() ? 'Vormonat (Voreinstellung, nach dem Laufdatum des Modells)' : ''">
          <span class="ac13-month-name">{{ name(m.label!) }}</span>
          <span class="ac13-month-n">{{ n(m.touren) }} Touren</span>
          @if (m.label === store.vormonat()) { <span class="ac13-month-tag">Vormonat</span> }
        </button>
      }
    </div>
    <div class="ac13-tiles" role="group" aria-label="Kennzahlen des Monats">
      @for (t of tiles(); track t.focus) {
        <div class="ac13-tile" [class.is-focus]="t.active">
          <button type="button" class="ac13-tile-hit" [attr.aria-pressed]="t.active" (click)="store.focus.set(t.focus); follow(t.focus)"
                  title="In den Ansichten hervorheben">
            <span class="ac13-tile-label">{{ t.label }}</span>
            <span class="ac13-tile-value">{{ t.value }}</span>
            <span class="ac13-tile-sub">{{ t.sub }}</span>
          </button>
          <div echarts class="ac13-spark" [options]="t.spark" [theme]="theme.echartsTheme()" chartGroup="ac13-monate"
               (chartClick)="month($any($event))" [attr.aria-label]="t.label + ' je Monat; Monat anklicken wählt ihn'"></div>
        </div>
      }
    </div>
  `,
})
export class MonthBar {
  protected readonly store = inject(Ac13Store);
  protected readonly theme = inject(ThemeService);
  protected readonly n = (v: number | null) => num(v);
  protected readonly name = (m: string) => monthShort(monthMs(m));

  protected readonly tiles = computed(() => {
    const rows = this.store.monate.rows();
    const sel = this.store.month();
    const cur = this.store.monthRow();
    const t = this.theme.tokens();
    const c = ac13Colors(this.theme.mode());
    const focus = this.store.focus();
    return TILES.map((d) => {
      const color = c[d.color];
      const spark: EChartsCoreOption = {
        animationDuration: 300,
        grid: { left: 0, right: 0, top: 4, bottom: 14 },
        xAxis: {
          type: 'category', data: rows.map((r) => r.monat), axisLine: { show: false },
          axisLabel: { color: t.muted, fontSize: 9.5, interval: 0, formatter: (v: string) => monthShort(monthMs(v)).replace(/\s.*$/, '') },
        },
        yAxis: { type: 'value', show: false, min: 0 },
        tooltip: {
          trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
          formatter: (ps: { dataIndex: number }[]) => {
            const r = rows[ps[0].dataIndex];
            return r ? ttHead(monthShort(monthMs(r.monat))) + ttRow(color, d.label, d.show(r)) + `<div style="opacity:.8">${d.sub(r)}</div>` : '';
          },
        },
        series: [{
          type: 'bar', barMaxWidth: 18, barCategoryGap: '24%', cursor: 'pointer',
          data: rows.map((r) => ({
            value: d.value(r), name: r.monat,
            itemStyle: { color, opacity: r.monat === sel ? 1 : 0.32, borderRadius: [2, 2, 0, 0] },
          })),
        }],
      };
      return { focus: d.focus, label: d.label, value: cur ? d.show(cur) : BLANK, sub: cur ? d.sub(cur) : '', active: d.focus === focus, spark };
    });
  });

  protected month(e: { name?: string }): void {
    if (e?.name) this.store.pickMonth(e.name);
  }
  protected follow(f: Focus): void {
    if (f === 'touren' || f === 'offen') this.store.heatMeasure.set('touren');
    if (f === 'az') this.store.azMeasure.set('arbeitszeit');
    if (f === 'schwelle') this.store.azMeasure.set('angerechnet');
    if (f === 'verkauft') this.store.heatMeasure.set('offen');
  }
}
