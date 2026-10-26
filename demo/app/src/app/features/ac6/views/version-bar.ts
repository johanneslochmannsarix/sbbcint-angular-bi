import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { BLANK, hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartGroup } from '../../../shared/connect';
import { ttHead, ttRow } from '../../../shared/chart-opts';
import { ac6Colors } from '../data/palette';
import { Ac6Store, DECODED, HEAT_LABEL, HeatMeasure, S1_NAME } from '../data/store';
import { KpiRow } from '../data/types';
import { DAY_LONG } from '../data/week';
import { UiSelect, UiSelectOption } from '../../../shared/ui';

interface TileDef {
  key: keyof KpiRow;
  label: string;
  show: (v: number | null) => string;
  focus: HeatMeasure | null;
  color: 'jup' | 'fahren';
}

const TILES: TileDef[] = [
  { key: 'touren', label: 'Touren der Musterwoche', show: (v) => num(v), focus: 'touren', color: 'jup' },
  { key: 'tourelemente', label: 'Tourelemente', show: (v) => num(v), focus: 'tourelemente', color: 'jup' },
  { key: 'dauer_h', label: 'Dauer Tourelemente', show: (v) => hours(v, 0), focus: 'dauer_h', color: 'jup' },
  { key: 'arbeitszeit_h', label: 'Arbeitszeit Tourelemente', show: (v) => hours(v, 0), focus: null, color: 'jup' },
  { key: 'fahranteil', label: 'Fahranteil', show: (v) => pct(v, 1), focus: 'fahren_h', color: 'fahren' },
  { key: 'dauer_je_tour_h', label: 'Ø Dauer je Tour', show: (v) => hours(v, 2), focus: null, color: 'jup' },
  { key: 'standorte', label: 'Tourstandorte', show: (v) => num(v), focus: null, color: 'jup' },
];

/**
 * View 0 - the version bar. A version is picked by NAME (validity fields empty, SAX-40); only «Schichtbildung 1»
 * carries a settled period, every other prefix is shown as delivered and marked undecoded. Underneath, the
 * report page's KPI card for that version, each tile with its weekday profile (Mo … So of the tour start):
 * clicking a weekday column filters every view to that weekday; clicking a tile with a heatmap measure makes
 * the heatmap show it. Sparklines share one echarts.connect group (tooltip on the same weekday).
 */
@Component({
  selector: 'ac6-version-bar',
  styleUrl: './version-bar.css',
  encapsulation: ViewEncapsulation.None,
  imports: [NgxEchartsDirective, ChartGroup, UiSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ac6-vbar' },
  template: `
    <div class="ac6-vpick">
      <label class="ac6-vlabel" for="ac6-version">JUP-Version</label>
      <ui-select selectId="ac6-version" extraClass="ac6-vselect" [options]="versionOptions()" [value]="versionValue()" (valueChange)="pick($event)" />
      <div class="ac6-chips">
        @if (decoded(); as d) {
          <span class="ac6-chip ac6-chip-ok" [title]="'Geklärt: ' + d">{{ d }}</span>
        } @else {
          <span class="ac6-chip ac6-chip-open" title="Die Namensbestandteile (CCO, CCD, CN, JFPL …) sind nicht entschlüsselt: der Name steht wie geliefert, eine Bedeutung wird nicht abgeleitet.">Präfix nicht entschlüsselt</span>
        }
        @if (!store.isS1()) {
          <span class="ac6-chip ac6-chip-open" title="Die Gültigkeitsfelder der JUP sind leer (SAX-40); eine Version wird nach Namen gewählt.">Zeitraum nicht geliefert (SAX-40)</span>
        }
        @if (store.drift()) {
          <span class="ac6-chip ac6-chip-warn" role="status">Modell neu geladen: Auswahl prüfen</span>
        }
      </div>
    </div>
    <div class="ac6-tiles" role="group" aria-label="Kennzahlen der Version je Musterwochentag">
      @for (t of tiles(); track t.key) {
        <div class="ac6-tile" [class.is-focus]="t.active">
          <button type="button" class="ac6-tile-hit" [disabled]="!t.focus" [attr.aria-pressed]="t.focus ? t.active : null"
                  [title]="t.focus ? 'Im Tourstandort-Raster zeigen' : ''" (click)="focus(t.focus)">
            <span class="ac6-tile-label">{{ t.label }}</span>
            <span class="ac6-tile-value">{{ t.value }}</span>
          </button>
          <div echarts class="ac6-spark" [options]="t.spark" [theme]="theme.echartsTheme()" chartGroup="ac6-tag"
               (chartClick)="day($any($event))" [attr.aria-label]="t.label + ' je Musterwochentag; Tag anklicken filtert'"></div>
        </div>
      }
    </div>
  `,
})
export class VersionBar {
  protected readonly store = inject(Ac6Store);
  protected readonly theme = inject(ThemeService);
  protected readonly n = (v: number | null) => num(v);
  protected readonly versionOptions = computed<UiSelectOption[]>(() =>
    this.store.versions().map((v) => ({ value: String(v.rang), label: `${v.label ?? ''} · ${this.n(v.touren)} Touren` })));
  protected readonly versionValue = computed(() => { const v = this.store.version(); return v == null ? '' : String(v); });

  protected readonly decoded = computed(() => DECODED[this.store.versionName() ?? ''] ?? null);

  private readonly total = computed(() => this.store.kpi.rows().find((r) => r.ist_gesamt) ?? null);
  private readonly days = computed(() => this.store.kpi.rows().filter((r) => !r.ist_gesamt && r.tag != null).sort((a, b) => a.tag! - b.tag!));

  protected readonly tiles = computed(() => {
    const tot = this.total();
    const days = this.days();
    const sel = this.store.tag();
    const t = this.theme.tokens();
    const c = ac6Colors(this.theme.mode());
    const focus = this.store.heatMeasure();
    const shown = sel != null ? days.find((d) => d.tag === sel) ?? null : tot;
    return TILES.map((d) => {
      const color = c[d.color];
      const spark: EChartsCoreOption = {
        animationDuration: 300,
        grid: { left: 0, right: 0, top: 4, bottom: 14 },
        xAxis: {
          type: 'category', data: days.map((r) => String(r.tag)), axisLine: { show: false },
          axisLabel: { color: t.muted, fontSize: 9.5, interval: 0, formatter: (v: string) => this.store.dayLabel(Number(v)) },
        },
        yAxis: { type: 'value', show: false, min: 0 },
        tooltip: {
          trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
          formatter: (ps: { name: string; value: number }[]) =>
            ttHead(DAY_LONG[Number(ps[0].name)] ?? ps[0].name) + ttRow(color, d.label, d.show(ps[0].value ?? null)),
        },
        series: [{
          type: 'bar', barMaxWidth: 16, barCategoryGap: '24%', cursor: 'pointer',
          data: days.map((r) => ({
            value: r[d.key] as number | null, name: String(r.tag),
            itemStyle: { color, opacity: sel == null || sel === r.tag ? 1 : 0.3, borderRadius: [2, 2, 0, 0] },
          })),
        }],
      };
      return {
        key: d.key, label: sel != null ? `${d.label}, ${this.store.dayLabel(sel)}` : d.label,
        value: shown ? d.show(shown[d.key] as number | null) : BLANK, focus: d.focus, active: d.focus != null && d.focus === focus, spark,
      };
    });
  });

  protected pick(v: string): void {
    const r = Number(v);
    this.store.pickVersion(this.store.versions().find((x) => x.label === S1_NAME)?.rang === r ? null : r);
  }
  protected focus(f: HeatMeasure | null): void {
    if (f) this.store.heatMeasure.set(f);
  }
  protected day(e: { name?: string }): void {
    if (e?.name == null) return;
    const nr = Number(e.name);
    this.store.pickTag(this.store.tag() === nr ? null : nr);
  }
  protected readonly heatLabel = HEAT_LABEL;
}
