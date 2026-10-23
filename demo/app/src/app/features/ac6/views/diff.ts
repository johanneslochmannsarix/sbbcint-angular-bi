import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { HATCH, HATCH_DARK, ac6Colors } from '../data/palette';
import { Ac6Store, DECODED } from '../data/store';
import { DiffRow } from '../data/types';

type Kind = DiffRow['kind'];
const KIND_LABEL: Record<Kind, string> = { standort: 'Tourstandort', ptyp: 'Personaltyp', taet: 'Tätigkeit', tag: 'Wochentag' };
const signedH = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v), 0)} h`;

/**
 * View 4 - version against version. A is the version in the bar, B a version that plans at least one of A's
 * Tourstandorte (dims vts; default: the one sharing most). Left: a diverging bar per Tourstandort / Personaltyp /
 * Tätigkeit / weekday of B − A planned hours (more = Himmelblau, less = Bronze, aligned by label - layout only);
 * a value only one side plans is hatched. Right: a slope chart of the eight largest changes, A on the left, B on
 * the right. Both sides are the same _Kennzahlen measure under each version's own filter; nothing is summed over
 * versions. Undecoded prefixes are marked; no period is inferred from a name.
 */
@Component({
  selector: 'ac6-diff',
  styleUrl: './diff.css',
  encapsulation: ViewEncapsulation.None,
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Was ändert sich zwischen zwei Versionen?" [q]="store.diff" idleText="Keine andere Version plant einen Tourstandort dieser Version."
              emptyNote="Unter diesem Filter planen beide Versionen nichts.">
      <div card-tools class="ac6-tools">
        <div class="seg seg-sm" role="group" aria-label="Gliederung">
          @for (k of kinds; track k) {
            <button type="button" [attr.aria-pressed]="kind() === k" (click)="kind.set(k)">{{ kindLabel[k] }}</button>
          }
        </div>
      </div>
      <div class="ac6-pair">
        <div class="ac6-pair-side">
          <span class="ac6-pair-tag">A</span>
          <span class="ac6-pair-name">{{ store.versionName() }}</span>
          <span class="ac6-pair-note">{{ noteOf(store.versionName()) }}</span>
        </div>
        <div class="ac6-pair-side">
          <span class="ac6-pair-tag">B</span>
          <select class="select ac6-pair-select" (change)="store.comparePick.set(+$any($event.target).value)" aria-label="Version B">
            @for (x of store.comparable(); track x.v.rang) {
              <option [value]="x.v.rang" [selected]="x.v.rang === store.compare()">{{ x.v.label }} · {{ x.shared }} gemeinsame Tourstandorte</option>
            }
          </select>
          <span class="ac6-pair-note">{{ noteOf(store.compareName()) }}</span>
        </div>
      </div>
      <p class="ac6-answer">{{ answer() }}</p>
      <div class="ac6-split">
        <div echarts class="chart" [style.height.px]="height()" [options]="bars()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"
             aria-label="Differenz B minus A der geplanten Stunden"></div>
        <div echarts class="chart" [style.height.px]="height()" [options]="slope()!" [theme]="theme.echartsTheme()"
             aria-label="Steigungsdiagramm der grössten Veränderungen von A nach B"></div>
      </div>
      <div class="ac6-legend">
        <span><i [style.background]="colors().more"></i>B plant mehr</span>
        <span><i [style.background]="colors().less"></i>B plant weniger</span>
        <span><i class="ac6-hatch" [style.background]="colors().neutral"></i>nur in einer Version</span>
      </div>
      <p class="ac6-note">Die Paarung folgt den Daten: angeboten werden nur Versionen mit gemeinsamen Tourstandorten. Welche Versionen das Controlling vergleicht, ist nicht festgelegt; eine Version ohne geklärten Zeitraum steht für keinen Zeitraum.</p>
    </app-card>
  `,
})
export class DiffView {
  protected readonly store = inject(Ac6Store);
  protected readonly theme = inject(ThemeService);
  protected readonly kinds: Kind[] = ['standort', 'ptyp', 'taet', 'tag'];
  protected readonly kindLabel = KIND_LABEL;
  protected readonly kind = signal<Kind>('standort');
  protected readonly colors = computed(() => ac6Colors(this.theme.mode()));

  protected noteOf(name: string | null): string {
    if (!name) return '';
    return DECODED[name] ?? 'Präfix nicht entschlüsselt, Zeitraum nicht geliefert';
  }

  private readonly rows = computed(() => {
    const k = this.kind();
    return this.store.diff.rows()
      .filter((r) => r.kind === k && r.label != null && ((r.h_a ?? 0) !== 0 || (r.h_b ?? 0) !== 0))
      .map((r) => ({ ...r, d: (r.h_b ?? 0) - (r.h_a ?? 0), only: (r.h_a == null || r.h_a === 0) ? 'B' : (r.h_b == null || r.h_b === 0) ? 'A' : null }));
  });
  private readonly ordered = computed(() => {
    const rs = this.rows();
    return this.kind() === 'tag' ? [...rs].sort((a, b) => (b.nr ?? 0) - (a.nr ?? 0)) : [...rs].sort((a, b) => a.d - b.d).slice(-28).sort((a, b) => a.d - b.d);
  });

  protected readonly height = computed(() => Math.max(260, this.ordered().length * 20 + 40));

  protected readonly answer = computed(() => {
    const rs = this.rows();
    if (!rs.length) return '';
    const a = rs.reduce((s, r) => s + (r.h_a ?? 0), 0);
    const b = rs.reduce((s, r) => s + (r.h_b ?? 0), 0);
    const up = [...rs].sort((x, y) => y.d - x.d)[0];
    const down = [...rs].sort((x, y) => x.d - y.d)[0];
    const lbl = (r: { label: string | null; nr: number | null }) => (this.kind() === 'tag' ? this.store.dayLabel(r.nr) : r.label);
    const onlyA = rs.filter((r) => r.only === 'A').length;
    const onlyB = rs.filter((r) => r.only === 'B').length;
    return `B plant ${hours(b, 0)} gegen ${hours(a, 0)} in A (${signedH(b - a)}). Am meisten dazu: ${lbl(up)} ${signedH(up.d)}; am meisten weg: ${lbl(down)} ${signedH(down.d)}.` +
      (onlyA || onlyB ? ` ${onlyA} ${KIND_LABEL[this.kind()]}-Werte nur in A, ${onlyB} nur in B.` : '');
  });

  protected readonly bars = computed<EChartsCoreOption | null>(() => {
    const rs = this.ordered();
    if (!rs.length) return null;
    const t = this.theme.tokens();
    const c = this.colors();
    const hatch = this.theme.mode() === 'dark' ? HATCH_DARK : HATCH;
    const tag = this.kind() === 'tag';
    const sel = this.kind() === 'standort' ? this.store.standortName() : this.kind() === 'ptyp' ? this.store.ptypName() : this.kind() === 'taet' ? this.store.taetName() : null;
    return {
      aria: ariaDecal(),
      animationDurationUpdate: 500,
      tooltip: {
        confine: true,
        formatter: (p: { dataIndex: number }) => {
          const r = rs[p.dataIndex];
          return ttHead(tag ? this.store.dayLabel(r.nr) : r.label ?? '') + ttRow(null, 'A', hours(r.h_a, 1)) + ttRow(null, 'B', hours(r.h_b, 1)) +
            ttRow(r.d >= 0 ? c.more : c.less, 'B − A', signedH(r.d)) + ttRow(null, 'Touren A → B', `${num(r.touren_a)} → ${num(r.touren_b)}`) +
            (r.only ? ttRow(null, 'nur in', r.only) : '');
        },
      },
      grid: { left: 8, right: 56, top: 6, bottom: 8, outerBounds: { left: 8, right: 56, top: 6, bottom: 8 } },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: (v: number) => num(v) } },
      yAxis: {
        type: 'category', data: rs.map((r) => (tag ? this.store.dayLabel(r.nr) : r.label)), axisTick: { show: false },
        axisLine: { show: false }, axisLabel: { color: t.ink2, width: 180, overflow: 'truncate', fontSize: 11.5,
          formatter: (v: string) => (v === sel ? `{s|${v}}` : v), rich: { s: { color: t.ink, fontWeight: 700, fontSize: 11.5 } } },
      },
      series: [{
        type: 'bar', barMaxWidth: 14, cursor: tag ? 'pointer' : 'pointer',
        data: rs.map((r) => ({
          value: r.d,
          itemStyle: { color: r.d >= 0 ? c.more : c.less, borderRadius: r.d >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4], decal: r.only ? hatch : undefined },
        })),
        label: { show: true, position: 'right', color: t.ink2, fontFamily: FONT_NUM, fontSize: 11, formatter: (p: { value: number }) => signedH(p.value) },
        markLine: { silent: true, symbol: 'none', data: [{ xAxis: 0 }], lineStyle: { color: t.ink2, type: 'solid', width: 1 }, label: { show: false } },
      }],
    };
  });

  protected readonly slope = computed<EChartsCoreOption | null>(() => {
    const rs = this.rows();
    if (!rs.length) return null;
    const t = this.theme.tokens();
    const c = this.colors();
    const tag = this.kind() === 'tag';
    const top = [...rs].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8);
    const name = (r: DiffRow) => (tag ? this.store.dayLabel(r.nr) : r.label ?? '');
    return {
      aria: ariaDecal(),
      animationDurationUpdate: 500,
      tooltip: { trigger: 'item', confine: true },
      grid: { left: 64, right: 190, top: 24, bottom: 16 },
      xAxis: { type: 'category', data: ['A', 'B'], boundaryGap: false, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: t.ink, fontFamily: FONT_NUM, fontWeight: 600 }, position: 'top' },
      yAxis: { type: 'value', show: false, min: 0 },
      series: top.map((r) => ({
        type: 'line', name: name(r), symbolSize: 8, lineStyle: { width: 2, color: r.d >= 0 ? c.more : c.less },
        itemStyle: { color: r.d >= 0 ? c.more : c.less, borderColor: t.surface, borderWidth: 2 },
        data: [r.h_a ?? 0, r.h_b ?? 0],
        tooltip: { formatter: () => ttHead(name(r)) + ttRow(null, 'A', hours(r.h_a, 1)) + ttRow(null, 'B', hours(r.h_b, 1)) + ttRow(r.d >= 0 ? c.more : c.less, 'B − A', signedH(r.d)) },
        endLabel: { show: true, color: t.ink2, fontSize: 11, width: 180, overflow: 'truncate', formatter: () => `${name(r)} · ${hours(r.h_b, 0)}` },
        label: { show: true, position: 'left', color: t.muted, fontSize: 11, formatter: (p: { dataIndex: number }) => (p.dataIndex === 0 ? hours(r.h_a, 0) : '') },
        labelLayout: { moveOverlap: 'shiftY' },
      })),
    };
  });

  protected click(e: { dataIndex?: number; seriesType?: string }): void {
    if (e?.dataIndex == null) return;
    const r = this.ordered()[e.dataIndex];
    if (!r) return;
    const k = this.kind();
    if (k === 'tag') this.store.pickTag(this.store.tag() === r.nr ? null : r.nr);
    else if (k === 'standort') { const x = this.store.rankOf('standort', r.label); this.store.pickStandort(this.store.standort() === x ? null : x); }
    else if (k === 'ptyp') { const x = this.store.rankOf('ptyp', r.label); this.store.pickPtyp(this.store.ptyp() === x ? null : x); }
    else { const x = this.store.rankOf('taet', r.label); this.store.pickTaet(this.store.taet() === x ? null : x); }
  }
}
