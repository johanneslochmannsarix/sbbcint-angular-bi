import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { hours, num, pct } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { HATCH, HATCH_DARK, ac4Colors } from '../data/palette';
import { Ac4Store, monthLabel } from '../data/store';
import { PtypRow } from '../data/types';

const TOP = 10;
const FAHREN = [['ja', 'Fahren = ja'], ['nein', 'Fahren = nein'], [null, 'ohne Tätigkeit']] as const;
const QUELLE = [['Stammdaten', 'aus Stammdaten'], ['abgeleitet', 'abgeleitet'], ['abgeleitet, mehrdeutig', 'abgeleitet, mehrdeutig']] as const;
const ZUORD = ['eingeteilt', 'Person nicht im Export', 'keine Person eingeteilt'] as const;

/** Σ of a returned additive measure over the rows matching `pick` (roll-up for layout). */
function sum(rows: PtypRow[], pick: (r: PtypRow) => boolean, f: 'plandauer_h' | 'tourelemente' = 'plandauer_h'): number {
  let s = 0;
  for (const r of rows) if (pick(r)) s += r[f] ?? 0;
  return s;
}

/**
 * View 2 - Tätigkeiten & Personaltypen. Left: Plandauer per Personaltyp der Tour, stacked by Fahren - the
 * report's «Plandauer je Personaltyp der Tour». Right: Plandauer per Personaltyp der Person, stacked by where
 * that type comes from (F5): Stammdaten, abgeleitet, abgeleitet mehrdeutig (hatched, so the derived share is a
 * shape, not only a colour); below it the «Person Zuordnung» of the elements as one 100 % bar. SBB Cargo
 * Deutschland workers are withheld on purpose (SAX-30): their type is derived, their names never exist.
 * Clicking a Personaltyp Tour filters every view.
 */
@Component({
  selector: 'ac4-personaltypen',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Welche Personaltypen fahren, und woher kennen wir den Typ?" [q]="store.personaltypen">
      <p class="ac4-answer">{{ answer() }}</p>
      <div class="ac4-split">
        <div>
          <h3 class="ac4-h3">Personaltyp der Tour</h3>
          <div echarts class="chart" [style.height.px]="leftHeight()" [options]="left()!" [theme]="theme.echartsTheme()" (chartClick)="pick($any($event))"></div>
        </div>
        <div>
          <h3 class="ac4-h3">Personaltyp der Person, nach Quelle</h3>
          <div echarts class="chart" [style.height.px]="rightHeight()" [options]="right()!" [theme]="theme.echartsTheme()"></div>
          <h3 class="ac4-h3">Person Zuordnung der Tourelemente</h3>
          <div echarts class="chart" style="height: 64px" [options]="zuord()!" [theme]="theme.echartsTheme()"></div>
        </div>
      </div>
      <p class="ac4-cover">{{ cover() }}</p>
    </app-card>
  `,
})
export class PersonaltypenView {
  protected readonly store = inject(Ac4Store);
  protected readonly theme = inject(ThemeService);
  private readonly c = computed(() => ac4Colors(this.theme.mode()));
  private readonly hatch = computed(() => (this.theme.mode() === 'dark' ? HATCH_DARK : HATCH));

  private readonly rows = computed(() => this.store.personaltypen.rows());
  private readonly tourTypes = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.rows()) m.set(r.personaltyp_tour ?? '–', (m.get(r.personaltyp_tour ?? '–') ?? 0) + (r.plandauer_h ?? 0));
    const s = [...m].sort((a, b) => b[1] - a[1]);
    return { top: s.slice(0, TOP).map((x) => x[0]), rest: s.slice(TOP).map((x) => x[0]) };
  });
  private readonly personTypes = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.rows()) if (r.personaltyp_person) m.set(r.personaltyp_person, (m.get(r.personaltyp_person) ?? 0) + (r.plandauer_h ?? 0));
    return [...m].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  });
  protected readonly leftHeight = computed(() => Math.max(220, (this.tourTypes().top.length + (this.tourTypes().rest.length ? 1 : 0)) * 26 + 54));
  protected readonly rightHeight = computed(() => Math.max(160, this.personTypes().length * 22 + 30));

  protected readonly answer = computed(() => {
    const rows = this.rows();
    const withPerson = sum(rows, (r) => r.person_zuordnung !== 'keine Person eingeteilt', 'tourelemente');
    const derived = sum(rows, (r) => (r.quelle ?? '').startsWith('abgeleitet'), 'tourelemente');
    if (!withPerson) return '';
    return `Bei ${pct(derived / withPerson)} der Tourelemente mit Person ist der Personaltyp abgeleitet, nicht aus den Stammdaten (${monthLabel(this.store.month())}): das sind die Lokführenden von SBB Cargo Deutschland.`;
  });
  protected readonly cover = computed(() => {
    const rows = this.rows();
    const mehrd = sum(rows, (r) => r.quelle === 'abgeleitet, mehrdeutig', 'tourelemente');
    return `«Person nicht im Export»: eingeteilt, aber SBB Cargo Deutschland liefert keine Personendaten (SAX-30); Name und Personalnummer fehlen, nur der Personaltyp ist aus einer Zuordnungstabelle abgeleitet. ${num(mehrd)} Elemente haben mehrere mögliche Typen («mehrdeutig»). Der Typ der Person ist gröber als der Typ der Tour.`;
  });

  protected readonly left = computed<EChartsCoreOption | null>(() => {
    const rows = this.rows();
    if (!rows.length) return null;
    const t = this.theme.tokens();
    const c = this.c();
    const { top, rest } = this.tourTypes();
    const cats = [...top, ...(rest.length ? [`übrige ${rest.length}`] : [])].reverse();
    const restSet = new Set(rest);
    const sel = this.store.ptypName();
    const val = (cat: string, f: string | null) => cat.startsWith('übrige ') && !top.includes(cat)
      ? sum(rows, (r) => restSet.has(r.personaltyp_tour ?? '–') && r.fahren === f)
      : sum(rows, (r) => (r.personaltyp_tour ?? '–') === cat && r.fahren === f);
    return {
      aria: ariaDecal(),
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: t.ink2 } },
      grid: { left: 4, right: 16, top: 28, bottom: 4, outerBounds: { left: 4, right: 16, top: 28, bottom: 4 } },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: t.grid } }, axisLabel: { formatter: (v: number) => num(v) } },
      yAxis: { type: 'category', data: cats, axisLabel: { color: t.ink2, width: 190, overflow: 'truncate' } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { name: string; seriesName: string; value: number; color: string }[]) =>
          ttHead(ps[0].name) + ps.map((p) => ttRow(p.color, p.seriesName, hours(p.value, 0))).join(''),
      },
      series: FAHREN.map(([f, label], i) => ({
        type: 'bar', stack: 'f', name: label, barMaxWidth: 16, cursor: 'pointer',
        itemStyle: { color: f === 'ja' ? c.fahren : f === 'nein' ? c.plan : c.neutral, borderColor: t.surface, borderWidth: 1 },
        data: cats.map((cat) => ({
          value: val(cat, f),
          itemStyle: { opacity: !sel || sel === cat ? 1 : 0.35, borderRadius: i === 2 ? [0, 4, 4, 0] : 0 },
        })),
      })),
    };
  });

  protected readonly right = computed<EChartsCoreOption | null>(() => {
    const rows = this.rows();
    const types = this.personTypes();
    if (!types.length) return null;
    const t = this.theme.tokens();
    const c = this.c();
    const cats = [...types].reverse();
    const color: Record<string, string> = { Stammdaten: c.plan, abgeleitet: c.ist, 'abgeleitet, mehrdeutig': c.ist };
    return {
      aria: ariaDecal(),
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: t.ink2 } },
      grid: { left: 4, right: 16, top: 28, bottom: 4, outerBounds: { left: 4, right: 16, top: 28, bottom: 4 } },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: t.grid } }, axisLabel: { formatter: (v: number) => num(v) } },
      yAxis: { type: 'category', data: cats, axisLabel: { color: t.ink2, width: 170, overflow: 'truncate' } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
        formatter: (ps: { name: string; seriesName: string; value: number; color: string }[]) =>
          ttHead(ps[0].name) + ps.filter((p) => p.value).map((p) => ttRow(p.color, p.seriesName, hours(p.value, 0))).join(''),
      },
      series: QUELLE.map(([q, label]) => ({
        type: 'bar', stack: 'q', name: label, barMaxWidth: 14,
        itemStyle: { color: color[q], borderColor: t.surface, borderWidth: 1, decal: q === 'Stammdaten' ? undefined : { ...this.hatch(), dashArrayY: q === 'abgeleitet' ? [2, 4] : [1, 2] } },
        data: cats.map((cat) => sum(rows, (r) => r.personaltyp_person === cat && r.quelle === q)),
      })),
    };
  });

  protected readonly zuord = computed<EChartsCoreOption | null>(() => {
    const rows = this.rows();
    const total = sum(rows, () => true, 'tourelemente');
    if (!total) return null;
    const t = this.theme.tokens();
    const c = this.c();
    return {
      aria: ariaDecal(),
      grid: { left: 0, right: 0, top: 0, bottom: 22 },
      xAxis: { type: 'value', max: 1, show: false },
      yAxis: { type: 'category', data: ['Elemente'], show: false },
      tooltip: { confine: true, formatter: (p: { seriesName: string; value: number; color: string }) => ttRow(p.color, p.seriesName, pct(p.value, 1)) },
      series: ZUORD.map((z) => {
        const share = sum(rows, (r) => r.person_zuordnung === z, 'tourelemente') / total;
        return {
          type: 'bar', stack: 'z', name: z, barWidth: 22,
          itemStyle: { color: c.zuordnung[z], borderColor: t.surface, borderWidth: 2 },
          label: { show: share > 0.08, position: 'bottom', distance: 4, color: t.ink2, formatter: () => `${z} ${pct(share)}` },
          data: [share],
        };
      }),
    };
  });

  protected pick(e: { name?: string }): void {
    const name = e?.name;
    if (!name || name.startsWith('übrige ')) return;
    const rank = this.store.ptypRank(name);
    if (rank == null) return;
    this.store.ptyp.set(this.store.ptyp() === rank ? null : rank);
    this.store.tour.set(null);
  }
}
