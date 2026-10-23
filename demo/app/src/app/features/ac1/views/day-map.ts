import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { dateLong, num, timeLocal } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { esc, ttHead } from '../../../shared/chart-opts';
import { ChartResize } from '../../../shared/chart-resize';
import { QualLink } from '../../../shared/qual-link';
import { Audience, DayRow, LocationEntry, Position, positionAt, spanOf, tourKey } from '../data/model';
import { Ac1Store, label } from '../data/store';

const MAP = 'ac1-europe';
const STEP = 15;                                  // minutes per timeline step
const STEPS = (24 * 60) / STEP;
const STATUS_TEXT: Record<LocationEntry['status'], string> = {
  ok: 'ok', ambiguous: 'Name mehrdeutig in Bronze', absent: 'nicht in Bronze', no_coord: 'ohne Koordinaten',
  withheld: 'adressähnlich, zurückgehalten',
};

interface Placed {
  key: string;
  audience: Audience;
  pos: Position;
}

/**
 * View 5: where everyone is on the selected day according to PLAN, on an offline basemap (Natural Earth 1:10m
 * admin-0, clipped to the measured bbox, features/ac1/assets/). A timeline steps the clock in 15 min:
 * at a location (im Einsatz / zwischen Einsätzen) = effectScatter; on a tour from A to B = the line A -> B
 * carries the person («unterwegs»). There are no intermediate positions in the data, so none are drawn.
 * Locations come from Bronze by name (/api/ac1/locations); names without coordinates are listed, not dropped.
 * Linked: the clock drives the Gantt's time line; hovering a Gantt bar highlights its line here.
 */
@Component({
  selector: 'ac1-day-map',
  imports: [NgxEchartsDirective, ChartResize, ChartCard, QualLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card [heading]="heading()" [sub]="sub()" [q]="[store.dayTours, $any(store.locations)]" idleText="Einen Tag im Kalender anklicken.">
      <div class="map-layout">
        @if (mapReady()) {
          <div echarts class="chart map" [options]="options()" [theme]="theme.echartsTheme()" (chartInit)="init($event)"></div>
        } @else {
          <div class="map state state-loading"><span class="spinner" aria-hidden="true"></span>Karte lädt</div>
        }
        <aside class="map-side" aria-live="polite">
          <p class="map-clock">{{ clockText() }}</p>
          <dl class="map-counts">
            <div><dt>unterwegs</dt><dd>{{ counts().moving }}</dd></div>
            <div><dt>im Einsatz an einem Ort</dt><dd>{{ counts().at }}</dd></div>
            <div><dt>zwischen Einsätzen</dt><dd>{{ counts().between }}</dd></div>
            <div><dt>nicht im Dienst</dt><dd>{{ counts().off }}</dd></div>
          </dl>
          @if (movingList().length) {
            <h3>Unterwegs</h3>
            <ul class="plain">
              @for (m of movingList(); track m.key) {
                <li><button type="button" class="linkish" (click)="store.openPerson(m.key, m.audience)">{{ m.who }}</button>
                  <span class="muted">{{ m.route }}</span>
                  <app-qual-link [person]="m.key" tenant="RTS" [env]="store.env()" text="Quali ›" /></li>
              }
            </ul>
          }
          @if (missing().length) {
            <h3>Orte ohne Kartenposition</h3>
            <ul class="plain">
              @for (m of missing(); track m.name) {
                <li>{{ m.name }} <span class="muted">({{ m.why }}, {{ m.n }} Touren)</span></li>
              }
            </ul>
          }
        </aside>
      </div>
      <p class="chart-note">Position laut Plan, keine Ortung: unterwegs heisst «auf der Tour von A nach B», ohne Zwischenposition. Basiskarte Natural Earth (gemeinfrei), offline.</p>
    </app-card>
  `,
  styles: [`
    .map-layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; }
    .map { height: 520px; }
    .map-side { border-left: 1px solid var(--rule); padding-left: 14px; max-height: 520px; overflow: auto; font-size: 13px; }
    .map-side h3 { font-size: 13px; margin: 12px 0 4px; }
    .map-clock { font-family: var(--font-display); font-size: 26px; margin: 0 0 6px; font-variant-numeric: tabular-nums; }
    .map-counts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 0; }
    .map-counts div { display: flex; flex-direction: column-reverse; }
    .map-counts dt { color: var(--muted); font-size: 11.5px; }
    .map-counts dd { margin: 0; font-family: var(--font-display); font-size: 18px; font-variant-numeric: tabular-nums; }
    .plain { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
    .plain li { display: flex; flex-direction: column; }
    @media (max-width: 900px) { .map-layout { grid-template-columns: minmax(0, 1fr); } .map-side { border-left: 0; padding-left: 0; } }
  `],
})
export class DayMapView {
  protected readonly store = inject(Ac1Store);
  protected readonly theme = inject(ThemeService);
  protected readonly mapReady = signal(false);
  private chart: ECharts | null = null;
  private shownIdx = -1;

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
    // clock moved elsewhere (new day) -> move the timeline; hover in the Gantt -> highlight the line
    effect(() => {
      const idx = Math.round(this.store.minute() / STEP);
      const c = this.live('timeline');
      if (c && idx !== this.shownIdx) c.dispatchAction({ type: 'timelineChange', currentIndex: idx });
    });
    effect(() => {
      const k = this.store.hoverTour();
      const c = this.live('series');
      if (!c) return;
      c.dispatchAction({ type: 'downplay', seriesId: 'tours' });
      const i = k == null ? -1 : untracked(() => this.lineIndex().get(k) ?? -1);
      if (i >= 0) c.dispatchAction({ type: 'highlight', seriesId: 'tours', dataIndex: i });
    });
    inject(DestroyRef).onDestroy(() => (this.chart = null));
  }

  /** The chart, only once its option holds `component`. A chart re-created after the day was cleared has no
   *  option yet when the clock effect fires; a dispatch then throws inside echarts and leaves the instance stuck
   *  «in main process» (every later setOption is refused). */
  private live(component: 'timeline' | 'series'): ECharts | null {
    const c = this.chart;
    if (!c || c.isDisposed()) return null;
    const o = c.getOption() as Record<string, unknown[] | undefined> | undefined;
    return o?.[component]?.length ? c : null;
  }

  protected init(c: ECharts): void {
    this.chart = c;
    c.on('timelinechanged', (e: any) => {
      this.shownIdx = e.currentIndex;
      this.store.minute.set(e.currentIndex * STEP);
    });
    c.on('timelineplaychanged', (e: any) => this.store.playing.set(!!e.playState));
    c.on('click', (e: any) => {
      const k = e?.data?.focusKey as string | undefined;
      if (k) this.store.openPerson(k);
    });
  }

  private readonly locs = computed(() => {
    const m = new Map<string, LocationEntry>();
    for (const l of this.store.locations.result()?.locations ?? []) if (l.name) m.set(l.name, l);
    return m;
  });
  private xy(name: string | null): [number, number] | null {
    const l = name ? this.locs().get(name) : undefined;
    return l && l.status === 'ok' && l.lat != null && l.lon != null ? [l.lon, l.lat] : null;
  }

  /** every moving tour of the day (von != nach, both placeable): the grey network, indexed by tourKey */
  private readonly lines = computed(() => {
    const out: { key: string; from: [number, number]; to: [number, number]; row: DayRow }[] = [];
    for (const r of this.store.dayTours.rows()) {
      if (!r.start_location || !r.end_location || r.start_location === r.end_location) continue;
      const a = this.xy(r.start_location);
      const b = this.xy(r.end_location);
      if (a && b) out.push({ key: tourKey(r), from: a, to: b, row: r });
    }
    return out;
  });
  private readonly lineIndex = computed(() => new Map(this.lines().map((l, i) => [l.key, i])));

  private placedAt(minute: number): Placed[] {
    const d = this.store.day();
    if (d == null) return [];
    const t = d + minute * 60_000;
    return [...this.store.dayRowsByPerson().entries()].map(([key, rows]) => ({
      key, audience: this.store.audienceOf(key), pos: positionAt(rows, t),
    }));
  }

  private readonly now = computed(() => this.placedAt(this.store.minute()));
  protected readonly counts = computed(() => {
    const c = { moving: 0, at: 0, between: 0, off: 0 };
    for (const p of this.now()) {
      if (p.pos.kind === 'tour') p.pos.moving ? c.moving++ : c.at++;
      else if (p.pos.kind === 'between') c.between++;
      else c.off++;
    }
    return c;
  });
  protected readonly movingList = computed(() =>
    this.now()
      .filter((p) => p.pos.kind === 'tour' && p.pos.moving)
      .map((p) => {
        const r = (p.pos as { row: DayRow }).row;
        return { key: p.key, audience: p.audience, who: label(this.store.personOf(p.key)), route: `${r.start_location} → ${r.end_location}` };
      })
      .sort((a, b) => Number(b.key === this.store.person()) - Number(a.key === this.store.person()) || a.who.localeCompare(b.who)),
  );
  /** Names the backend returned without a position are listed with the reason. A name it did not return at
   *  all was withheld (address-like): it is counted, never named. */
  protected readonly missing = computed(() => {
    const n = new Map<string, number>();
    let withheld = 0;
    for (const r of this.store.dayTours.rows()) {
      for (const name of new Set([r.start_location, r.end_location])) {
        if (!name || this.xy(name)) continue;
        if (!this.locs().has(name)) withheld++;
        else n.set(name, (n.get(name) ?? 0) + 1);
      }
    }
    const out = [...n.entries()].map(([name, c]) => ({ name, n: c, why: STATUS_TEXT[this.locs().get(name)!.status] }));
    if (withheld) out.push({ name: 'Adressähnliche Orte', n: withheld, why: STATUS_TEXT.withheld });
    return out;
  });

  protected readonly heading = computed(() => {
    const d = this.store.day();
    return d == null ? 'Wo laut Plan' : `Wo laut Plan, ${dateLong(d)}`;
  });
  protected readonly sub = computed(() => {
    const n = this.store.dayRowsByPerson().size;
    return n ? `${num(n)} Personen mit Plan an diesem Tag. Zeitleiste abspielen oder ziehen; Punkt anklicken öffnet den Tagesplan.` : '';
  });
  protected readonly clockText = computed(() => {
    const c = this.store.clock();
    return c == null ? '–' : timeLocal(c);
  });

  protected readonly options = computed<EChartsCoreOption>(() => {
    const t = this.theme.tokens();
    const d = this.store.day();
    if (d == null || !this.mapReady()) return {};
    const lines = this.lines();
    const focus = this.store.person();
    const used = new Map<string, [number, number]>();
    for (const r of this.store.dayTours.rows()) {
      for (const name of [r.start_location, r.end_location]) {
        const p = this.xy(name);
        if (name && p) used.set(name, p);
      }
    }
    const pts = [...used.values()];
    const lon = pts.map((p) => p[0]);
    const lat = pts.map((p) => p[1]);
    const center = pts.length ? [(Math.min(...lon) + Math.max(...lon)) / 2, (Math.min(...lat) + Math.max(...lat)) / 2] : [8.2, 47.0];
    const span = pts.length ? Math.max(Math.max(...lon) - Math.min(...lon), (Math.max(...lat) - Math.min(...lat)) * 1.5, 0.6) : 4;
    const zoom = Math.max(1, Math.min(9, 9 / span));
    const colorOf = (a: Audience) => (a === 'ausbilder' ? t.series[0] : t.series[1]);
    const store = this.store;

    const stepOption = (minute: number) => {
      const placed = this.placedAt(minute);
      const atLoc = new Map<string, Map<Audience, Placed[]>>();
      const moving = new Map<string, { from: [number, number]; to: [number, number]; people: Placed[] }>();
      for (const p of placed) {
        if (p.pos.kind === 'tour' && p.pos.moving) {
          const r = p.pos.row;
          const a = this.xy(r.start_location);
          const b = this.xy(r.end_location);
          if (!a || !b) continue;
          const k = `${r.start_location}→${r.end_location}`;
          (moving.get(k) ?? moving.set(k, { from: a, to: b, people: [] }).get(k)!).people.push(p);
          continue;
        }
        const name = p.pos.kind === 'tour' ? p.pos.row.start_location : p.pos.kind === 'between' ? p.pos.at : null;
        if (!name || !this.xy(name)) continue;
        const byAud = atLoc.get(name) ?? atLoc.set(name, new Map()).get(name)!;
        (byAud.get(p.audience) ?? byAud.set(p.audience, []).get(p.audience)!).push(p);
      }
      const scatter = (aud: Audience) => [...atLoc.entries()]
        .filter(([, m]) => m.has(aud))
        .map(([name, m]) => {
          const ps = m.get(aud)!;
          const hasFocus = ps.some((p) => p.key === focus);
          return {
            name, value: [...this.xy(name)!, ps.length],
            focusKey: hasFocus ? focus : ps.length === 1 ? ps[0].key : undefined,
            people: ps.map((p) => `${label(store.personOf(p.key))} (${p.pos.kind === 'between' ? 'zwischen Einsätzen' : 'im Einsatz'})`),
            label: { show: hasFocus, formatter: label(store.personOf(focus ?? '')), position: 'right', color: t.ink, fontWeight: 600 },
          };
        });
      return {
        series: [
          { id: 'at-ausbilder', data: scatter('ausbilder') },
          { id: 'at-azubi', data: scatter('auszubildende') },
          {
            id: 'active',
            data: [...moving.values()].map((m) => {
              const hasFocus = m.people.some((p) => p.key === focus);
              const aud = m.people.filter((p) => p.audience === 'ausbilder').length >= m.people.length / 2 ? 'ausbilder' : 'auszubildende';
              return {
                coords: [m.from, m.to],
                people: m.people.map((p) => label(store.personOf(p.key))),
                lineStyle: { color: colorOf(aud), width: hasFocus ? 3 : 2, opacity: 0.95 },
                label: { show: true, position: 'middle', color: t.ink, fontSize: 11,
                  formatter: hasFocus ? `${label(store.personOf(focus ?? ''))} unterwegs` : `${m.people.length} unterwegs` },
              };
            }),
          },
        ],
      };
    };

    const steps = Array.from({ length: STEPS }, (_, i) => i * STEP);
    const idx = Math.round(untracked(() => this.store.minute()) / STEP);
    this.shownIdx = idx;
    const option: Record<string, unknown> = {
      baseOption: {
        animation: false,
        timeline: {
          axisType: 'category', data: steps.map((m) => timeLocal(d + m * 60_000)), currentIndex: idx,
          autoPlay: false, loop: true, playInterval: 700, bottom: 4, left: 40, right: 40,
          label: { interval: 7, color: t.muted, fontSize: 10 },
          symbolSize: 6,
          checkpointStyle: { color: t.ink, borderColor: t.surface, symbolSize: 12 },
          controlStyle: { color: t.ink2, borderColor: t.ink2 },
          progress: { lineStyle: { color: t.ink2 }, itemStyle: { color: t.ink2 } },
          emphasis: { label: { color: t.ink } },
        },
        legend: { top: 0, left: 0, data: ['Ausbilder', 'Auszubildende'], textStyle: { color: t.ink2 }, icon: 'circle', itemWidth: 9, itemHeight: 9 },
        tooltip: {
          confine: true,
          formatter: (p: any) => {
            if (p.componentType === 'timeline') return esc(p.name);
            if (p.seriesId === 'loc') return ttHead(p.name);
            if (p.seriesId === 'tours') {
              const l = lines[p.dataIndex];
              const s = spanOf(l.row);
              return ttHead(`${l.row.tourbezeichnung ?? 'Tour'}`) + `${esc(l.row.start_location)} → ${esc(l.row.end_location)}<br>`
                + (s ? `Plan ${timeLocal(s.start)}–${timeLocal(s.end)}<br>` : '') + esc(label(store.personOf(l.row.person_sk)));
            }
            const people: string[] = p.data?.people ?? [];
            const head = p.seriesId === 'active' ? 'unterwegs' : `${p.name}, ${p.seriesName}`;
            return ttHead(head) + people.slice(0, 12).map((x) => esc(x)).join('<br>') + (people.length > 12 ? `<br>… ${people.length - 12} weitere` : '');
          },
        },
        geo: {
          map: MAP, roam: true, center, zoom, scaleLimit: { min: 1, max: 40 }, top: 28, bottom: 64, left: 8, right: 8,
          itemStyle: { areaColor: t.grid, borderColor: t.axis, borderWidth: 0.8 },
          emphasis: { disabled: true }, select: { disabled: true }, silent: true,
          label: { show: false },
        },
        series: [
          {
            type: 'scatter', id: 'loc', coordinateSystem: 'geo', symbolSize: 5,
            itemStyle: { color: t.surface, borderColor: t.ink2, borderWidth: 1 },
            data: [...used.entries()].map(([name, p]) => ({ name, value: p })),
            label: { show: used.size <= 25, formatter: '{b}', position: 'bottom', color: t.muted, fontSize: 10 },
            labelLayout: { hideOverlap: true },
          },
          {
            type: 'lines', id: 'tours', coordinateSystem: 'geo', z: 2,
            data: lines.map((l) => ({ coords: [l.from, l.to] })),
            lineStyle: { color: t.axis, width: 1, opacity: 0.7, curveness: 0.15 },
            emphasis: { lineStyle: { color: t.ink, width: 3, opacity: 1 } },
          },
          {
            type: 'lines', id: 'active', coordinateSystem: 'geo', zlevel: 1, data: [],
            lineStyle: { curveness: 0.15 },
            effect: { show: true, period: 2.5, trailLength: 0.45, symbol: 'circle', symbolSize: 5, loop: true },
            silent: false,
          },
          {
            type: 'effectScatter', id: 'at-ausbilder', name: 'Ausbilder', coordinateSystem: 'geo', zlevel: 1, z: 4, data: [],
            symbolSize: (v: number[]) => 8 + Math.min(14, (v[2] ?? 1) * 3), itemStyle: { color: colorOf('ausbilder') },
            rippleEffect: { brushType: 'stroke', scale: 2.6, period: 3 }, showEffectOn: 'render',
          },
          {
            type: 'effectScatter', id: 'at-azubi', name: 'Auszubildende', coordinateSystem: 'geo', zlevel: 1, data: [],
            symbolSize: (v: number[]) => 8 + Math.min(14, (v[2] ?? 1) * 3), itemStyle: { color: colorOf('auszubildende') },
            rippleEffect: { brushType: 'stroke', scale: 2.6, period: 3 }, showEffectOn: 'render',
          },
        ],
      },
      options: steps.map(stepOption),
    };
    return option as EChartsCoreOption;
  });
}
