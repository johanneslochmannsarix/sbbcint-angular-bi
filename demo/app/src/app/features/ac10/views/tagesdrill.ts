import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ChartResize } from '../../../shared/chart-resize';
import { ThemeService } from '../../../core/theme';
import { BLANK, addDays, dateLong, dayMs, localMs, num, timeLocal } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac10Store } from '../data/store';
import { ac10Colors, hatchCss, hatchFill, kategorieRank, kategorieStyle, landHue } from '../data/palette';
import { PositionRow } from '../data/types';
import { UiButton, UiSeg, UiTable } from '../../../shared/ui';

const LANE_H = 15;
const MAX_VISIBLE_LANES = 56;
const TABLE_MAX = 400;

interface Placed {
  row: PositionRow;
  lane: number;
  start: number;
  end: number;
  group: string;
  tier: 1 | 2;
}

/** first-fit lane packing inside each group (layout only); groups in the given order */
function pack(rows: PositionRow[], groupOf: (r: PositionRow) => string, order: (a: string, b: string) => number, tier: 1 | 2, offset: number) {
  const groups = new Map<string, PositionRow[]>();
  for (const r of rows) {
    const g = groupOf(r);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const placed: Placed[] = [];
  const lanes: { label: string; group: string; first: boolean; tier: 1 | 2 }[] = [];
  let base = offset;
  for (const g of [...groups.keys()].sort(order)) {
    const ends: number[] = [];
    const rs = groups.get(g)!.map((r) => ({ r, s: localMs(r.planned_start) ?? 0, e: localMs(r.planned_end) ?? 0 }))
      .sort((a, b) => a.s - b.s || b.e - a.e);
    for (const { r, s, e } of rs) {
      const end = Math.max(e, s + 600_000);
      let lane = ends.findIndex((x) => x <= s);
      if (lane < 0) {
        lane = ends.length;
        ends.push(end);
      } else ends[lane] = end;
      placed.push({ row: r, lane: base + lane, start: s, end, group: g, tier });
    }
    for (let i = 0; i < Math.max(1, ends.length); i++) lanes.push({ label: g, group: g, first: i === 0, tier });
    base += Math.max(1, ends.length);
  }
  return { placed, lanes, next: base };
}

/**
 * View 3 - Tagesdrill: one day (picked in the heatmap / band, default today) as a Gantt of plan start..end.
 * Without a depot: the day's OPEN shifts, one lane group per depot. With a depot: all its shifts, one group per
 * Personaltyp, open ones in the open hue (nicht zwingend lighter + hatched), filled ones a muted outline - never
 * red. Below, in their own lanes: the day's Schichtelemente ohne Schicht per category (they have no depot, R2).
 * Lane packing is layout only. The Detailliste under it is the report's drill-through list for that day; a
 * click on a bar or a row opens the position (pseudo-id S-xxxxxxxx; Bezeichnung masked to T- tokens).
 */
@Component({
  selector: 'ac10-tagesdrill',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, UiSeg, UiButton, UiTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card [heading]="heading()" [sub]="sub()" [q]="[store.tagSchichten, store.tagElemente]">
      <div card-tools class="ac10-tools">
        <ui-seg size="sm" ariaLabel="Tag wechseln" [actions]="true" (valueChange)="shift($event)"
          [options]="[{ value: -1, label: '‹', ariaLabel: 'Vorheriger Tag' }, { value: 1, label: '›', ariaLabel: 'Nächster Tag' }]" />
        @if (!store.depot()) {
          <label class="ac10-check"><input type="checkbox" [checked]="showFilled()" (change)="showFilled.set(!showFilled())" /> auch besetzte</label>
        }
        <label class="ac10-check"><input type="checkbox" [checked]="showElements()" (change)="showElements.set(!showElements())" /> Schichtelemente ohne Schicht</label>
      </div>
      <div class="ac10-legend ac10-legend-left">
        <span><i class="key" [style.background]="colors().open"></i>offen, zwingend</span>
        <span><i class="key" [style.background]="hatchCss(colors().openSoft)"></i>offen, nicht zwingend</span>
        <span><i class="key ac10-key-filled"></i>besetzt</span>
        @if (showElements()) {
          @for (k of kategorien(); track k.label) {
            <span><i class="key" [style.background]="k.css"></i>{{ k.label }}</span>
          }
        }
      </div>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))" role="img" [attr.aria-label]="heading()"></div>
      <details class="ac10-list" [open]="listOpen()" (toggle)="listOpen.set($any($event.target).open)">
        <summary>Detailliste: {{ num(listRows().length) }} Positionen{{ listRows().length > TABLE_MAX ? ', die ersten ' + TABLE_MAX + ' gezeigt' : '' }}</summary>
        <div class="table-wrap ac10-table">
          <table class="tbl tbl-click" uiTable>
            <thead><tr>
              <th>Start (Plan)</th><th>Ende (Plan)</th><th>Status</th><th>Mandant</th><th>Depot</th><th>Haupt-Personaltyp</th><th>Personaltyp / Kategorie</th>
              <th>Bezeichnung</th><th>Von</th><th>Nach</th><th class="r">Elemente</th><th>ID</th>
            </tr></thead>
            <tbody>
              @for (r of listRows().slice(0, TABLE_MAX); track r.position_sk) {
                <tr [class.is-selected]="r.position_sk === store.position()" [class.is-muted]="!r.is_offen" (click)="store.pickPosition(r.position_sk)">
                  <td>{{ t(r.planned_start) }}</td><td>{{ t(r.planned_end) }}</td>
                  <td>{{ status(r) }}</td><td>{{ r.mandant ?? BLANK }}</td><td>{{ r.depot ?? BLANK }}</td><td>{{ r.haupttyp ?? BLANK }}</td>
                  <td>{{ r.position_typ === 'Schicht' ? r.personaltyp : r.fahren_kategorie }}</td>
                  <td>{{ r.position_name ?? BLANK }}</td><td>{{ r.von ?? BLANK }}</td><td>{{ r.nach ?? BLANK }}</td>
                  <td class="r">{{ num(r.fahrelement_anzahl) }}</td><td class="ac10-id">S-{{ r.position_sk.slice(0, 8) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    </app-card>

    @if (selected(); as p) {
      <div class="scrim" (click)="store.pickPosition(null)" aria-hidden="true"></div>
      <aside class="drawer" role="dialog" aria-label="Position">
        <header class="drawer-head">
          <div>
            <p class="ac10-kicker">{{ p.position_typ }} · S-{{ p.position_sk.slice(0, 8) }}</p>
            <h2>{{ p.position_name ?? 'ohne Bezeichnung' }}</h2>
          </div>
          <ui-button kind="ghost" (click)="store.pickPosition(null)" label="Schliessen">×</ui-button>
        </header>
        <div class="drawer-body drawer-pad">
          <dl class="ac10-dl">
            <dt>Status</dt><dd>{{ status(p) }}</dd>
            <dt>Start (Plan)</dt><dd>{{ dt(p.planned_start) }}</dd>
            <dt>Ende (Plan)</dt><dd>{{ dt(p.planned_end) }}</dd>
            <dt>Mandant</dt><dd>{{ p.mandant ?? BLANK }}</dd>
            <dt>Depot</dt><dd>{{ p.depot ?? BLANK }}</dd>
            <dt>Haupt-Personaltyp</dt><dd>{{ p.haupttyp ?? BLANK }}</dd>
            <dt>{{ p.position_typ === 'Schicht' ? 'Personaltyp' : 'Kategorie' }}</dt><dd>{{ p.position_typ === 'Schicht' ? p.personaltyp : p.fahren_kategorie }}</dd>
            <dt>Von</dt><dd>{{ p.von ?? BLANK }}</dd>
            <dt>Nach</dt><dd>{{ p.nach ?? BLANK }}</dd>
            <dt>Schichtelemente</dt><dd>{{ num(p.fahrelement_anzahl) }}</dd>
            <dt>Liste</dt><dd>{{ p.fahrelement_liste ?? BLANK }}</dd>
          </dl>
          <p class="chart-note">Offen = keine Person zugeordnet, sonst nichts (Kundenregel). Bezeichnung und Elementliste sind Freitext aus SaxMS und
            erscheinen pseudonymisiert (T-…), Klartext nur mit <code>run.ps1 -Real</code>. Es gibt keinen Zustand «geschlossen» (SAX-28 offen).</p>
        </div>
      </aside>
    }
  `,
})
export class TagesdrillView {
  protected readonly store = inject(Ac10Store);
  protected readonly theme = inject(ThemeService);
  protected readonly showFilled = signal(false);
  protected readonly showElements = signal(true);
  protected readonly listOpen = signal(false);
  protected readonly num = num;
  protected readonly BLANK = BLANK;
  protected readonly TABLE_MAX = TABLE_MAX;
  protected readonly hatchCss = hatchCss;
  protected readonly colors = computed(() => ac10Colors(this.theme.tokens()));

  protected t(v: string | null): string {
    const ms = localMs(v);
    if (ms == null) return BLANK;
    const day = dayMs(this.store.drillDay())!;
    const off = Math.floor((ms - day) / 86_400_000);
    return timeLocal(ms) + (off > 0 ? ` +${off}` : off < 0 ? ` ${off}` : '');
  }
  protected dt(v: string | null): string {
    const ms = localMs(v);
    return ms == null ? BLANK : `${dateLong(ms)} ${timeLocal(ms)}`;
  }
  protected status(r: PositionRow): string {
    if (r.position_typ !== 'Schicht') return 'ohne Schicht';
    return `${r.is_offen ? 'offen' : 'besetzt'}${r.is_zwingend ? '' : ', nicht zwingend'}`;
  }

  private readonly tier1 = computed(() => {
    const rows = this.store.tagSchichten.rows();
    return this.store.depot() || this.showFilled() ? rows : rows.filter((r) => r.is_offen);
  });
  private readonly tier2 = computed(() => (this.showElements() ? this.store.tagElemente.rows() : []));
  protected readonly listRows = computed(() => [...this.tier1(), ...this.tier2()]
    .sort((a, b) => (a.planned_start ?? '').localeCompare(b.planned_start ?? '') || (a.depot ?? '').localeCompare(b.depot ?? '', 'de')));
  protected readonly selected = computed(() => {
    const p = this.store.position();
    if (!p) return null;
    return [...this.store.tagSchichten.rows(), ...this.store.tagElemente.rows()].find((r) => r.position_sk === p) ?? null;
  });

  protected readonly heading = computed(() => {
    const d = dateLong(dayMs(this.store.drillDay())!);
    const where = this.store.depot() ?? this.store.mandant() ?? 'alle Depots';
    return `Tagesdrill ${d}: ${where}`;
  });
  protected readonly sub = computed(() => {
    const s = this.store.tagSchichten.rows();
    const open = s.filter((r) => r.is_offen).length;
    const e = this.store.tagElemente.rows().length;
    const what = this.store.depot() ? `${num(s.length)} Schichten, davon ${num(open)} offen` :
      this.showFilled() ? `${num(s.length)} Schichten, davon ${num(open)} offen` : `${num(open)} offene Schichten (von ${num(s.length)})`;
    return `${what} · ${num(e)} Schichtelemente ohne Schicht. Balken = Planbeginn bis Planende; Klick öffnet die Position.`;
  });
  protected readonly kategorien = computed(() => {
    const t = this.theme.tokens();
    return [...new Set(this.store.tagElemente.rows().map((r) => r.fahren_kategorie ?? ''))].filter((k) => k)
      .sort((a, b) => kategorieRank(a) - kategorieRank(b))
      .map((k) => {
        const st = kategorieStyle(k);
        const hue = landHue(t, st.land);
        return { label: k, css: st.hatch ? hatchCss(hue) : hue };
      });
  });

  private readonly layout = computed(() => {
    const byDepot = !this.store.depot();
    const g1 = (r: PositionRow) => (byDepot ? `${r.depot ?? '(unbekannt)'}` : `${r.personaltyp ?? '(ohne Personaltyp)'}`);
    const a = pack(this.tier1(), g1, (x, y) => x.localeCompare(y, 'de'), 1, 0);
    const b = pack(this.tier2(), (r) => r.fahren_kategorie ?? '', (x, y) => kategorieRank(x) - kategorieRank(y), 2, a.next);
    return { placed: [...a.placed, ...b.placed], lanes: [...a.lanes, ...b.lanes] };
  });
  protected readonly height = computed(() => Math.min(MAX_VISIBLE_LANES, Math.max(4, this.layout().lanes.length)) * LANE_H + 64);

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const { placed, lanes } = this.layout();
    if (!lanes.length || (!this.store.tagSchichten.result() && !this.store.tagElemente.result())) return null;
    const t = this.theme.tokens();
    const c = ac10Colors(t);
    const day = dayMs(this.store.drillDay())!;
    const x0 = day;
    const x1 = addDays(day, 1) + 12 * 3_600_000;
    const sel = this.store.position();
    const many = lanes.length > MAX_VISIBLE_LANES;
    const groupStarts = lanes.map((l, i) => (l.first ? i : -1)).filter((i) => i >= 0);
    const tierBreak = lanes.findIndex((l) => l.tier === 2);
    type Fill = string | ReturnType<typeof hatchFill>;
    const styleOf = (p: Placed): { fill: Fill; key: string; stroke: string | null } => {
      if (p.tier === 2) {
        const st = kategorieStyle(p.row.fahren_kategorie ?? '');
        const hue = landHue(t, st.land);
        return { fill: st.hatch ? hatchFill(hue, 'rgba(255,255,255,0.6)') : hue, key: hue, stroke: null };
      }
      if (!p.row.is_offen) return { fill: c.filled, key: c.filled, stroke: c.filledLine };
      return p.row.is_zwingend ? { fill: c.open, key: c.open, stroke: null } : { fill: hatchFill(c.openSoft, c.open), key: c.openSoft, stroke: c.open };
    };
    return {
      animation: placed.length < 600,
      aria: ariaDecal(),
      grid: { left: 190, right: 12, top: 26, bottom: many ? 8 : 4 },
      xAxis: {
        type: 'time', min: x0, max: x1, position: 'top', splitNumber: 12,
        axisLabel: { formatter: (v: number) => timeLocal(v) + (v >= addDays(day, 1) ? ' +1' : ''), fontSize: 11, hideOverlap: true },
        splitLine: { show: true, lineStyle: { color: t.grid } },
      },
      yAxis: {
        type: 'category', inverse: true, data: lanes.map((_, i) => String(i)),
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: {
          interval: 0, width: 180, overflow: 'truncate', fontSize: 11,
          formatter: (v: string) => {
            const l = lanes[Number(v)];
            return l.first ? l.label : '';
          },
          color: t.ink2,
        },
      },
      // slider only: an 'inside' zoom would take the mouse wheel and stop the page from scrolling over the chart
      dataZoom: many ? [{ type: 'slider', yAxisIndex: 0, right: 0, width: 10, startValue: 0, endValue: MAX_VISIBLE_LANES - 1, showDetail: false, brushSelect: false, filterMode: 'weakFilter' }] : [],
      tooltip: {
        confine: true,
        formatter: (p: { data?: { p?: Placed } }) => {
          const q = p.data?.p;
          if (!q) return '';
          const r = q.row;
          const st = styleOf(q);
          return ttHead(`${r.position_name ?? 'ohne Bezeichnung'}`) +
            `<div style="color:${t.muted};margin:-2px 0 4px">${esc(r.position_typ === 'Schicht' ? `${r.depot ?? ''} · ${r.personaltyp ?? ''}` : (r.fahren_kategorie ?? ''))}</div>` +
            ttRow(st.key, this.status(r), `${this.t(r.planned_start)} – ${this.t(r.planned_end)}`) +
            ttRow(null, 'Von → Nach', `${r.von ?? BLANK} → ${r.nach ?? BLANK}`) + ttRow(null, 'Schichtelemente', num(r.fahrelement_anzahl));
        },
      },
      series: [
        {
          // group bands + the tier separator: one item per group, drawn behind the bars
          type: 'custom', silent: true, z: 0,
          data: groupStarts.map((s, k) => [s, (groupStarts[k + 1] ?? lanes.length) - 1, k]),
          renderItem: (params: { coordSys: { x: number; width: number } }, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
            const [, ya] = api.coord([x0, api.value(0)]);
            const [, yb] = api.coord([x0, api.value(1)]);
            const h = api.size([0, 1])[1];
            const k = api.value(2);
            const top = ya - h / 2;
            const isBreak = tierBreak >= 0 && api.value(0) === tierBreak;
            return {
              type: 'group', children: [
                { type: 'rect', shape: { x: params.coordSys.x, y: top, width: params.coordSys.width, height: yb - ya + h },
                  style: { fill: k % 2 ? t.surface : t.grid, opacity: k % 2 ? 1 : 0.35 } },
                ...(isBreak ? [{ type: 'line', shape: { x1: params.coordSys.x - 180, y1: top, x2: params.coordSys.x + params.coordSys.width, y2: top },
                  style: { stroke: t.ink2, lineWidth: 1 } }] : []),
              ],
            };
          },
        },
        {
          type: 'custom', z: 2, progressive: 400,
          encode: { x: [1, 2], y: 0 },
          data: placed.map((p) => ({ value: [p.lane, Math.max(p.start, x0), Math.min(p.end, x1), p.end > x1 ? 1 : 0], p })),
          renderItem: (params: { dataIndex: number }, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
            const p = placed[params.dataIndex];
            const s = styleOf(p);
            const isSel = sel === p.row.position_sk;
            const lane = api.value(0);
            const a = api.coord([api.value(1), lane]);
            const b = api.coord([api.value(2), lane]);
            const h = Math.max(4, api.size([0, 1])[1] - 4);
            return {
              type: 'rect', shape: { x: a[0], y: a[1] - h / 2, width: Math.max(2, b[0] - a[0]), height: h, r: 2 },
              style: { fill: s.fill, stroke: isSel ? t.ink : s.stroke ?? undefined, lineWidth: isSel ? 2 : s.stroke ? 1 : 0 },
            };
          },
        },
      ],
    };
  });

  protected click(e: { seriesIndex?: number; data?: { p?: Placed } }): void {
    const p = e.data?.p;
    if (p) this.store.pickPosition(this.store.position() === p.row.position_sk ? null : p.row.position_sk);
  }
  protected shift(n: number): void {
    const d = addDays(dayMs(this.store.drillDay())!, n);
    this.store.pickDay(localIso(d) === this.store.today ? null : localIso(d));
  }
}

function localIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
