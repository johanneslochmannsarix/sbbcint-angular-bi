import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartGroup } from '../../../shared/connect';
import { ChartResize } from '../../../shared/chart-resize';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { Ac7Store } from '../data/store';
import { LocationEntry, OrtRow } from '../data/types';

const MAP = 'ac7-europe';
const STATUS_TEXT: Record<string, string> = {
  ambiguous: 'mehrdeutig (mehrere Koordinaten)', absent: 'nicht in den Stammdaten', no_coord: 'ohne Koordinate', withheld: 'zurückgehalten (adressähnlich)',
};

/**
 * View 5 - where: persons per stint location as a ranked list and on the map (AC-1's basemap, Natural Earth, served
 * offline from /assets/ac1/; coordinates from AC-1's route: Bronze abstractcustomlocation by name, address-like names
 * withheld). Both charts carry the same items in the same order and share an echarts.connect group, so the tooltip of
 * one shows on the other. A click filters by the location (either of the two stints there); the view ignores its own
 * `ort` filter and highlights the pick.
 */
@Component({
  selector: 'ac7-where',
  imports: [NgxEchartsDirective, ChartCard, ChartGroup, ChartResize],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wo sind die Einsätze?" [sub]="sub()" [q]="[store.orte, store.locations]">
      <div class="ac7-where">
        <div echarts class="chart ac7-where-list" [style.height.px]="listHeight()" [options]="listOptions()!" [theme]="theme.echartsTheme()"
             chartGroup="ac7-where" (chartClick)="click($event)"></div>
        @if (mapReady()) {
          <div echarts class="chart ac7-where-map" [options]="mapOptions()!" [theme]="theme.echartsTheme()" chartGroup="ac7-where" (chartClick)="click($event)"></div>
        } @else {
          <p class="chart-note">Die Karte ist nicht geladen (Basiskarte /assets/ac1/ nicht erreichbar); die Liste links ist vollständig.</p>
        }
      </div>
      <p class="chart-note">Ort = Startort der ersten Tour des Einsatzes (Betriebsstelle). {{ offMap() }}</p>
    </app-card>
  `,
})
export class WhereView {
  protected readonly store = inject(Ac7Store);
  protected readonly theme = inject(ThemeService);
  protected readonly mapReady = signal(false);

  constructor() {
    const http = inject(HttpClient);
    import('../../../core/echarts-setup').then((e) => {
      if (e.getMap(MAP)) {
        this.mapReady.set(true);
        return;
      }
      http.get<object>('/assets/ac1/europe-central.geo.json').subscribe({
        next: (gj) => {
          e.registerMap(MAP, gj as never);
          this.mapReady.set(true);
        },
        error: () => this.mapReady.set(false),
      });
    });
  }

  /** locations with someone under the filter, busiest first; the same order feeds both charts (connect by index) */
  private readonly items = computed(() => {
    const coords = new Map<string, LocationEntry>();
    for (const l of this.store.locations.result()?.locations ?? []) if (l.name) coords.set(l.name, l);
    return this.store.orte.rows()
      .filter((r) => (r.personen ?? 0) > 0)
      .sort((a, b) => (b.personen ?? 0) - (a.personen ?? 0) || a.ort.localeCompare(b.ort, 'de'))
      .map((r) => ({ r, loc: coords.get(r.ort) ?? null }));
  });
  protected readonly listHeight = computed(() => Math.max(160, Math.min(this.items().length, 16) * 22 + 40));
  protected readonly sub = computed(() => {
    const n = this.items().length;
    return n ? `${num(n)} Orte; Länge = Personen mit einem der zwei gezeigten Einsätze dort; Klick filtert` : '';
  });
  protected readonly offMap = computed(() => {
    const off = this.items().filter((i) => !i.loc || i.loc.lat == null);
    if (!off.length) return 'Alle Orte haben eine Koordinate.';
    const by = new Map<string, number>();
    for (const i of off) {
      const s = i.loc?.status ?? 'absent';
      by.set(s, (by.get(s) ?? 0) + 1);
    }
    return `Nicht auf der Karte: ${[...by].map(([s, n]) => `${n} ${STATUS_TEXT[s] ?? s}`).join(', ')} – in der Liste enthalten.`;
  });

  private tip(r: OrtRow): string {
    return ttHead(r.ort) + ttRow(null, 'Personen (einer der zwei Einsätze)', num(r.personen)) + ttRow(null, 'davon letzter Einsatz', num(r.personen_einsatz1))
      + ttRow(null, 'vorletzter Einsatz', num(r.personen_einsatz2))
      + `<div style="opacity:.7;margin-top:4px">Klicken: ${this.store.ort() === r.rang ? 'Filter aufheben' : 'nach diesem Ort filtern'}</div>`;
  }

  protected readonly listOptions = computed<EChartsCoreOption | null>(() => {
    const items = this.items();
    if (!items.length) return null;
    const t = this.theme.tokens();
    const pick = this.store.ort();
    const many = items.length > 16;
    return {
      animation: false,
      aria: ariaDecal(),
      grid: { left: 4, right: many ? 30 : 36, top: 4, bottom: 4, outerBounds: { left: 4, right: many ? 30 : 36, top: 4, bottom: 4 } },
      tooltip: { trigger: 'item', confine: true, formatter: (p: { dataIndex: number }) => this.tip(items[p.dataIndex].r) },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', inverse: true, data: items.map((i) => i.r.ort), axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: t.ink2, width: 170, overflow: 'truncate', fontSize: 12 } },
      dataZoom: many ? [
        { type: 'slider', yAxisIndex: 0, right: 4, width: 12, startValue: 0, endValue: 15, showDetail: false, zoomLock: true, brushSelect: false },
        { type: 'inside', yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: true },
      ] : [],
      series: [{
        type: 'bar', id: 'orte', barMaxWidth: 14,
        data: items.map((i) => ({
          value: i.r.personen,
          itemStyle: { color: pick == null || pick === i.r.rang ? t.seq[4] : t.seq[1], borderRadius: [0, 4, 4, 0] },
        })),
        label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: { value: number }) => num(p.value) },
      }],
    };
  });

  protected readonly mapOptions = computed<EChartsCoreOption | null>(() => {
    const items = this.items();
    if (!items.length || !this.mapReady()) return null;
    const t = this.theme.tokens();
    const pick = this.store.ort();
    const pts = items.filter((i) => i.loc?.lat != null);
    if (!pts.length) return null;
    const lons = pts.map((i) => i.loc!.lon!);
    const lats = pts.map((i) => i.loc!.lat!);
    const pad = 0.6;
    const max = Math.max(...items.map((i) => i.r.personen ?? 0), 1);
    return {
      animation: false,
      aria: ariaDecal(),
      tooltip: { trigger: 'item', confine: true, formatter: (p: { dataIndex: number }) => this.tip(items[p.dataIndex].r) },
      geo: {
        map: MAP, roam: true, silent: true,
        boundingCoords: [[Math.min(...lons) - pad, Math.max(...lats) + pad], [Math.max(...lons) + pad, Math.min(...lats) - pad]],
        itemStyle: { areaColor: t.grid, borderColor: t.axis },
      },
      series: [{
        type: 'scatter', id: 'orte', coordinateSystem: 'geo',
        // same items, same order as the list (connect by index); a location without a coordinate stays as an empty slot
        data: items.map((i) => ({
          name: i.r.ort,
          value: i.loc?.lat != null ? [i.loc.lon, i.loc.lat, i.r.personen] : [NaN, NaN, i.r.personen],
          itemStyle: { color: pick == null || pick === i.r.rang ? t.seq[4] : t.seq[1], borderColor: t.surface, borderWidth: 1, opacity: 0.9 },
        })),
        symbolSize: (v: number[]) => 6 + 18 * Math.sqrt((v[2] ?? 0) / max),
        emphasis: { scale: 1.3, itemStyle: { borderColor: t.ink, borderWidth: 2 } },
      }],
    };
  });

  protected click(e: { seriesId?: string; dataIndex?: number }): void {
    if (e.seriesId !== 'orte' || e.dataIndex == null) return;
    const i = this.items()[e.dataIndex];
    if (i) this.store.setOrt(i.r.ort);
  }
}
