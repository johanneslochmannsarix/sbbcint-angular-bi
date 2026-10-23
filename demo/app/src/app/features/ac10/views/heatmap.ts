import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ChartResize } from '../../../shared/chart-resize';
import { ThemeService } from '../../../core/theme';
import { dateShort, dayMs, isoDay, num, today } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac10Store } from '../data/store';
import { ac10Colors, landHue, landOfMandant } from '../data/palette';
import { DepotTagRow } from '../data/types';

const WD = new Intl.DateTimeFormat('de-CH', { weekday: 'short' });
const ROW_H = 21;

interface Row {
  key: string;
  kind: 'mandant' | 'depot';
  mandant: string;
  depot: string | null;
}

/** relative luminance of #rrggbb, for the cell label's ink */
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * View 1 - Belegungstafel: every dim_scope depot (zero-shift depots and the «(unbekannt)» = kein-Depot error rows
 * included, R4) x every day of the window. Cell = [Anzahl ungeplante Schichten] on the sequential ramp, the
 * nicht-zwingend part as a light corner, a cell with no shift planned at all hatched and empty. Rows are grouped
 * under their Mandant (Land hue on the header). Click a cell: drill depot + day; click a row label: pick it.
 */
@Component({
  selector: 'ac10-heatmap',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wo fehlt wann wer? Ungeplante Schichten je Depot und Tag"
              [sub]="sub()" [q]="[store.depotTage, store.scope]">
      <div card-tools class="ac10-legend" aria-label="Legende">
        @for (b of buckets(); track b.label) {
          <span><i class="key" [style.background]="b.color"></i>{{ b.label }}</span>
        }
        <span><i class="key ac10-key-corner"></i>davon nicht zwingend</span>
        <span><i class="key ac10-key-empty"></i>keine Schicht geplant</span>
      </div>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()"
           (chartClick)="click($any($event))" role="img"
           [attr.aria-label]="'Ungeplante Schichten je Depot und Tag, ' + rows().length + ' Zeilen'"></div>
      <p class="chart-note">«(unbekannt)» als Depot ist die Fehlerzeile «kein Depot zugeordnet» (vom Kunden verlangt), so wie das Modell sie liefert.
        Unter «(kein Mandant)» liegen nur Schichtelemente ohne Schicht; sie zählen hier nicht und haben ihre eigene Ansicht.</p>
    </app-card>
  `,
})
export class HeatmapView {
  protected readonly store = inject(Ac10Store);
  protected readonly theme = inject(ThemeService);

  protected readonly rows = computed<Row[]>(() => {
    const cells = this.store.depotTage.rows();
    const byDepot = new Map<string, { mandant: string; depot: string; open: number }>();
    for (const c of cells) {
      const k = `${c.tenant_name}\u001f${c.depot_name}`;
      const e = byDepot.get(k) ?? { mandant: c.tenant_name, depot: c.depot_name, open: 0 };
      e.open += c.ungeplant ?? 0;
      byDepot.set(k, e);
    }
    const mandanten = [...new Set([...byDepot.values()].map((e) => e.mandant))]
      .sort((a, b) => (a.startsWith('(') ? 1 : 0) - (b.startsWith('(') ? 1 : 0) || a.localeCompare(b, 'de'));
    const out: Row[] = [];
    for (const m of mandanten) {
      out.push({ key: `M\u001f${m}`, kind: 'mandant', mandant: m, depot: null });
      // layout order only: most open first inside the Mandant, error label last
      const ds = [...byDepot.values()].filter((e) => e.mandant === m)
        .sort((a, b) => (a.depot.startsWith('(') ? 1 : 0) - (b.depot.startsWith('(') ? 1 : 0) || b.open - a.open || a.depot.localeCompare(b.depot, 'de'));
      for (const d of ds) out.push({ key: `D\u001f${m}\u001f${d.depot}`, kind: 'depot', mandant: m, depot: d.depot });
    }
    return out;
  });
  protected readonly height = computed(() => Math.max(160, this.rows().length * ROW_H + 44));

  /** colour buckets from quantiles of the returned non-zero cell values (layout, not a business number) */
  private readonly thresholds = computed(() => {
    const v = this.store.depotTage.rows().map((r) => r.ungeplant).filter((x) => x > 0).sort((a, b) => a - b);
    if (!v.length) return [1];
    const qn = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
    return [...new Set([1, qn(0.4), qn(0.7), qn(0.9)].map((x) => Math.max(1, Math.round(x))))].sort((a, b) => a - b);
  });
  private colorFor(u: number): string {
    const ramp = ac10Colors(this.theme.tokens()).ramp;
    const th = this.thresholds();
    let i = 0;
    for (let k = 0; k < th.length; k++) if (u >= th[k]) i = k + 1;
    const idx = [0, 2, 3, 4, 6][Math.min(i, 4)];
    return ramp[idx];
  }
  protected readonly buckets = computed(() => {
    const th = this.thresholds();
    return th.map((lo, k) => {
      const hi = th[k + 1] != null ? th[k + 1] - 1 : null;
      return { label: hi == null ? `≥ ${num(lo)}` : lo === hi ? num(lo) : `${num(lo)}–${num(hi)}`, color: this.colorFor(lo) };
    });
  });

  protected readonly sub = computed(() => {
    const n = this.rows().filter((r) => r.kind === 'depot').length;
    return `${n} Depots aus dem Modell (dim_scope), auch ohne Schichten. Zahl = ungeplante Schichten; Klick öffnet den Tag im Depot.`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const cells = this.store.depotTage.rows();
    const rows = this.rows();
    if (!cells.length || !rows.length) return null;
    const t = this.theme.tokens();
    const c = ac10Colors(t);
    const days = this.store.days();
    const dayIx = new Map(days.map((d, i) => [d, i]));
    const rowIx = new Map(rows.map((r, i) => [r.key, i]));
    const selDepot = this.store.depot() ? `D\u001f${this.store.mandant()}\u001f${this.store.depot()}` : null;
    const selDay = this.store.tag();
    const todayIso = isoDay(today());
    const data = cells.map((r: DepotTagRow) => ({
      value: [dayIx.get(r.datum.slice(0, 10)) ?? -1, rowIx.get(`D\u001f${r.tenant_name}\u001f${r.depot_name}`) ?? -1,
        r.ungeplant ?? 0, r.ungeplant_zwingend ?? 0, r.schichten ?? 0],
      row: r,
    })).filter((d) => d.value[0] >= 0 && d.value[1] >= 0);
    const rich: Record<string, unknown> = {
      d: { color: t.ink2, fontSize: 11.5 },
      e: { color: t.muted, fontSize: 11.5, fontStyle: 'italic' },
      m: { color: t.ink, fontSize: 12, fontWeight: 600, padding: [0, 0, 0, 4] },
      s: { color: t.ink, fontSize: 11.5, fontWeight: 600 },
      x: { width: 4, height: 13, backgroundColor: t.neutral },
    };
    for (const land of ['de', 'ch', 'it', 'nl', 'fr', 'be'] as const) rich[`x${land}`] = { width: 4, height: 13, backgroundColor: landHue(t, land) };
    const cellLabel = (u: number, fill: string) => (lum(fill) < 0.3 ? '#ffffff' : t.ink);
    return {
      animation: false,
      aria: ariaDecal(),
      grid: { left: 210, right: 8, top: 26, bottom: 18 },
      xAxis: {
        type: 'category', data: days, position: 'top', axisTick: { show: false }, axisLine: { show: false },
        axisLabel: {
          interval: days.length > 40 ? Math.ceil(days.length / 20) - 1 : 0, fontSize: 11,
          formatter: (d: string) => (days.length > 20 ? dateShort(dayMs(d)!) : `${WD.format(dayMs(d)!)} ${dateShort(dayMs(d)!)}`),
          color: t.muted,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category', data: rows.map((r) => r.key), inverse: true, triggerEvent: true,
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: {
          width: 200, overflow: 'truncate', align: 'left', margin: 206, rich,
          formatter: (key: string) => {
            const r = rows[rowIx.get(key)!];
            if (r.kind === 'mandant') return `{x${landOfMandant(r.mandant) ?? ''}|}{m|${r.mandant}}`;
            const sel = key === selDepot;
            return r.depot!.startsWith('(') ? `{e|  ${r.depot} · kein Depot}` : `{${sel ? 's' : 'd'}|  ${r.depot}}`;
          },
        },
      },
      tooltip: {
        confine: true,
        formatter: (p: { data?: { row: DepotTagRow; value: number[] } }) => {
          if (!p.data) return '';
          const r = p.data.row;
          const [, , u, z, s] = p.data.value;
          return ttHead(`${r.depot_name} · ${WD.format(dayMs(r.datum)!)} ${dateShort(dayMs(r.datum)!)}`) +
            `<div style="color:${t.muted};margin:-2px 0 4px">${esc(r.tenant_name)}</div>` +
            ttRow(this.colorFor(Math.max(1, u)), 'Ungeplante Schichten', num(u)) + ttRow(null, 'davon zwingend', num(z)) +
            ttRow(null, 'nicht zwingend', num(u - z)) + ttRow(null, 'Schichten insgesamt', num(s)) +
            (s === 0 ? `<div style="color:${t.muted};margin-top:4px">keine Schicht geplant</div>` : '');
        },
      },
      series: [{
        type: 'custom',
        data,
        encode: { x: 0, y: 1 },
        renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const x = api.value(0);
          const y = api.value(1);
          const u = api.value(2);
          const z = api.value(3);
          const s = api.value(4);
          const [cx, cy] = api.coord([x, y]);
          const [sw, sh] = api.size([1, 1]);
          const w = Math.max(2, sw - 2);
          const h = Math.max(2, sh - 3);
          const x0 = cx - w / 2;
          const y0 = cy - h / 2;
          const day = days[x];
          const children: unknown[] = [];
          if (s === 0) {
            children.push({ type: 'rect', shape: { x: x0, y: y0, width: w, height: h, r: 2 },
              style: { fill: 'transparent', stroke: t.grid, lineWidth: 1, decal: undefined } });
            children.push({ type: 'line', shape: { x1: x0 + 3, y1: y0 + h - 3, x2: x0 + w - 3, y2: y0 + 3 }, style: { stroke: t.grid, lineWidth: 1 } });
          } else {
            const fill = u > 0 ? this.colorFor(u) : t.grid;
            children.push({ type: 'rect', shape: { x: x0, y: y0, width: w, height: h, r: 2 }, style: { fill } });
            if (u - z > 0 && w >= 8) {
              const k = Math.min(w, h) * 0.5;
              children.push({ type: 'polygon', shape: { points: [[x0 + w - k, y0], [x0 + w, y0], [x0 + w, y0 + k]] }, style: { fill: t.seq[0], stroke: t.surface, lineWidth: 0.5 } });
            }
            if (u > 0 && w >= 22) {
              children.push({ type: 'text', style: { text: num(u), x: cx, y: cy + 0.5, align: 'center', verticalAlign: 'middle',
                fill: cellLabel(u, fill), font: `600 11px ${'Bahnschrift, "Segoe UI", sans-serif'}` } });
            }
          }
          const rowKey = rows[y]?.key;
          if ((selDepot && rowKey === selDepot) || (selDay && day === selDay)) {
            children.push({ type: 'rect', shape: { x: x0 - 1, y: y0 - 1, width: w + 2, height: h + 2, r: 2 },
              style: { fill: 'transparent', stroke: t.ink, lineWidth: selDepot && rowKey === selDepot && selDay === day ? 2 : 1 } });
          }
          return { type: 'group', children };
        },
        markLine: dayIx.has(todayIso) ? {
          silent: true, symbol: 'none', lineStyle: { color: c.today, width: 1.5, type: 'solid' },
          label: { formatter: 'heute', position: 'end', color: t.ink, fontSize: 11, fontWeight: 600 },
          data: [{ xAxis: todayIso }],
        } : undefined,
      }],
    };
  });

  protected click(e: { componentType?: string; value?: unknown; data?: { row?: DepotTagRow } }): void {
    if (e.componentType === 'yAxis' && typeof e.value === 'string') {
      const [kind, m, d] = e.value.split('\u001f');
      if (kind === 'M') this.store.pickMandant(this.store.mandant() === m && !this.store.depot() ? null : m);
      else if (this.store.depot() === d && this.store.mandant() === m) this.store.pickMandant(m);
      else this.store.pickDepot(m, d);
      return;
    }
    const r = e.data?.row;
    if (r) this.store.pickCell(r.tenant_name, r.depot_name, r.datum.slice(0, 10));
  }
}
