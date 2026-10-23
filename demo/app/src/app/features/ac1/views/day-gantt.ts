import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { Router } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import { dateLong, hours, num, timeLocal } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { ChartResize } from '../../../shared/chart-resize';
import { qualLinkParams } from '../../../shared/qual-link';
import { GROUP_ORDER, groupKey, groupLabel, groupPaint, inkOn } from '../data/colors';
import { AUDIENCE_LABEL, DayRow, Span, TAG_LABEL, TagRow, clip, lanes, spanOf, tourKey } from '../data/model';
import { Ac1Store, label } from '../data/store';

interface Bar {
  row: DayRow;
  span: Span;
  shown: Span;
  personIdx: number;
  lane: number;
  laneCount: number;
  key: string;
}

/**
 * View 2 (and 3 from the trainee side): the selected day as a Gantt. Row 1 is the «ansehen als» person, then
 * everyone linked to that day honestly: «gleicher Auftrag» (same training order that day) and/or «laut
 * Freitext» (named in an ALP:/TN:/Prüfer: tag, resolved to exactly one person server side). Bars = plan tours
 * (start/end of the order item), colour = activity group. Click a row label or a bar of another person to
 * open that person's day; hover a bar to highlight its line on the map. Replaces the Tagesraster CellText.
 */
@Component({
  selector: 'ac1-day-gantt',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card [heading]="heading()" [sub]="sub()" [q]="[store.dayTours, store.dayTags]"
      idleText="Einen Tag im Kalender anklicken."
      [forceEmpty]="!!store.dayTours.result() && bars().length === 0"
      emptyNote="Für diese Person ist an diesem Tag nichts geplant.">
      <div echarts class="chart" [style.height.px]="height()" [options]="options()" [theme]="theme.echartsTheme()"
        (chartClick)="click($any($event))" (chartMouseOver)="over($any($event))" (chartMouseOut)="store.hoverTour.set(null)"></div>
      @if (unresolved().length) {
        <p class="chart-note">Laut Freitext ohne eindeutige Person:
          @for (u of unresolved(); track u.text) {
            <span class="tag" [title]="u.title">{{ u.text }}</span>{{ ' ' }}
          }
        </p>
      }
      <div class="legend-inline gantt-legend" aria-label="Farblegende">
        @for (k of legend(); track k.key) {
          <span><span class="key" [style.background]="k.fill" [style.border]="k.stroke ? '1px solid ' + k.stroke : null"></span>{{ k.label }}</span>
        }
        <span class="muted">Strich = Uhrzeit der Karte</span>
      </div>
      <p class="chart-note">Nur Planzeiten. Eine Zuordnung Ausbilder ↔ Auszubildende gibt es im Export nicht; die Zeilen sagen, warum sie da sind.</p>
    </app-card>
  `,
  styles: [`.gantt-legend { justify-content: flex-start; margin-top: 4px; }`],
})
export class DayGanttView {
  protected readonly store = inject(Ac1Store);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  /** row order: focus first, then the related people */
  private readonly rowsKeys = computed(() => {
    const f = this.store.person();
    return f ? [f, ...this.store.related().map((r) => r.key)] : [];
  });

  private readonly reason = computed(() => {
    const m = new Map<string, string>();
    const f = this.store.person();
    if (f) m.set(f, `${AUDIENCE_LABEL[this.store.audience()]}, angesehen`);
    for (const r of this.store.related()) {
      const parts: string[] = [];
      if (r.sameOrder) parts.push('gleicher Auftrag');
      if (r.tags.length) parts.push('laut Freitext ' + r.tags.map((t) => TAG_LABEL[t as keyof typeof TAG_LABEL] ?? t).join('/'));
      m.set(r.key, `${AUDIENCE_LABEL[r.audience]}, ${parts.join(' + ')}`);
    }
    return m;
  });

  readonly bars = computed<Bar[]>(() => {
    const range = this.store.dayRange();
    if (!range) return [];
    const byPerson = this.store.dayRowsByPerson();
    const out: Bar[] = [];
    this.rowsKeys().forEach((key, personIdx) => {
      const rows = (byPerson.get(key) ?? [])
        .map((row) => ({ row, span: spanOf(row) }))
        .filter((x): x is { row: DayRow; span: Span } => !!x.span);
      const shown = rows.map((x) => clip(x.span, range.from, range.to) ?? { start: x.span.start, end: x.span.start + 15 * 60_000 });
      const l = lanes(shown);
      rows.forEach((x, i) => out.push({ row: x.row, span: x.span, shown: shown[i], personIdx, lane: l.lane[i], laneCount: l.count, key: tourKey(x.row) }));
    });
    return out;
  });

  private readonly maxLanes = computed(() => Math.max(1, ...this.bars().map((b) => b.laneCount)));
  protected readonly height = computed(() => 60 + Math.max(1, this.rowsKeys().length) * Math.max(44, Math.min(this.maxLanes(), 12) * 13 + 14));

  private readonly tagsByTour = computed(() => {
    const m = new Map<string, TagRow[]>();
    for (const t of this.store.tags()) {
      const k = tourKey(t);
      (m.get(k) ?? m.set(k, []).get(k)!).push(t);
    }
    return m;
  });

  protected readonly unresolved = computed(() => {
    const counts = new Map<string, { text: string; title: string; n: number }>();
    for (const t of this.store.unresolvedTags()) {
      const text = `${TAG_LABEL[t.tag]}: ${t.tag_name ?? '(leer)'}`;
      const why = t.match === 'several' ? 'mehrere Personen passen, nicht geraten' : t.match === 'empty' ? 'Marke ohne Namen' : 'keine Person im Modell passt';
      const e = counts.get(text) ?? { text, title: why, n: 0 };
      e.n++;
      counts.set(text, e);
    }
    return [...counts.values()];
  });

  protected readonly heading = computed(() => {
    const d = this.store.day();
    const f = this.store.focus();
    return d == null ? 'Tagesplan' : `Tagesplan ${dateLong(d)}${f ? ', ' + label(f.person) : ''}`;
  });
  protected readonly sub = computed(() => {
    const rel = this.store.related();
    if (this.store.day() == null) return '';
    const same = rel.filter((r) => r.sameOrder).length;
    const tag = rel.filter((r) => r.tags.length).length;
    return `${num(rel.length)} weitere Personen: ${num(same)} im gleichen Auftrag, ${num(tag)} laut Freitext. Zeile oder Balken anklicken öffnet den Tagesplan dieser Person, «Qualifikationen ›» ihre Qualifikationen (AC-2).`;
  });

  protected readonly legend = computed(() => {
    const t = this.theme.tokens();
    const present = new Set(this.bars().map((b) => groupKey(b.row.activity_group)));
    return GROUP_ORDER.filter((k) => present.has(k)).map((k) => ({ key: k, label: groupLabel(k), ...groupPaint(k, t) }));
  });

  protected readonly options = computed<EChartsCoreOption>(() => {
    const t = this.theme.tokens();
    const range = this.store.dayRange();
    const keys = this.rowsKeys();
    const bars = this.bars();
    const reason = this.reason();
    const focus = this.store.person();
    const clock = this.store.clock();
    if (!range) return {};
    const starts = bars.map((b) => b.shown.start);
    const ends = bars.map((b) => b.shown.end);
    const hour = 3_600_000;
    const min = starts.length ? Math.max(range.from, Math.floor((Math.min(...starts) - hour) / hour) * hour) : range.from + 6 * hour;
    const max = ends.length ? Math.min(range.to, Math.ceil((Math.max(...ends) + hour) / hour) * hour) : range.from + 20 * hour;
    const tagsByTour = this.tagsByTour();
    const store = this.store;
    return {
      animation: false,
      grid: { left: 8, right: 16, top: 26, bottom: 26, outerBounds: { left: 8, right: 16, top: 26, bottom: 26 } },
      tooltip: {
        confine: true,
        formatter: (p: { seriesType: string; dataIndex: number }) => {
          if (p.seriesType !== 'custom') return '';
          const b = bars[p.dataIndex];
          const r = b.row;
          const who = label(store.personOf(keys[b.personIdx]));
          const crosses = b.span.start < range.from || b.span.end > range.to;
          let html = ttHead(`${who}: ${r.tourbezeichnung ?? '(ohne Tour)'}`);
          html += ttRow(groupPaint(groupKey(r.activity_group), t).fill, groupLabel(groupKey(r.activity_group)), r.label_de ?? '');
          html += ttRow(null, 'Plan', `${timeLocal(b.span.start)}–${timeLocal(b.span.end)}${crosses ? ' (über Mitternacht)' : ''}`);
          html += ttRow(null, 'Dauer', hours((b.span.end - b.span.start) / hour));
          if (r.zugnummer) html += ttRow(null, 'Zug', r.zugnummer);
          html += ttRow(null, 'von → nach', `${r.start_location ?? '?'} → ${r.end_location ?? '?'}`);
          if (r.dor_name) html += ttRow(null, 'Auftrag', r.dor_name);
          if (r.kommentar) html += ttRow(null, 'Kommentar', r.kommentar);
          for (const tg of tagsByTour.get(b.key) ?? []) {
            const who2 = tg.linked_sk ? label(store.personOf(tg.linked_sk)) : `${tg.tag_name ?? '(leer)'} (nicht zuordenbar)`;
            html += ttRow(null, `laut Freitext ${TAG_LABEL[tg.tag]}`, who2);
          }
          if (keys[b.personIdx] !== focus) html += '<div style="opacity:.7;margin-top:4px">Klicken: Tagesplan dieser Person</div>';
          return html;
        },
      },
      xAxis: {
        type: 'time', min, max, position: 'top',
        axisLabel: { formatter: (v: number) => timeLocal(v), color: t.muted },
        splitLine: { show: true, lineStyle: { color: t.grid } },
        minInterval: hour,
      },
      yAxis: [{
        type: 'category', data: keys, inverse: true, triggerEvent: true,
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: {
          interval: 0, width: 210, overflow: 'truncate',
          formatter: (k: string) => `{n|${label(store.personOf(k))}}\n{r|${reason.get(k) ?? ''}}`,
          rich: {
            n: { fontSize: 12.5, fontWeight: 600, color: t.ink, lineHeight: 17 },
            r: { fontSize: 11, color: t.muted, lineHeight: 14 },
          },
        },
        splitLine: { show: true, lineStyle: { color: t.grid } },
      }, {
        // D2 cross-link: the same rows on the right, «Qualifikationen ›» opens AC-2 RT&S for that pseudonym
        type: 'category', data: keys, inverse: true, triggerEvent: true, position: 'right',
        axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false },
        axisLabel: { interval: 0, formatter: () => 'Qualifikationen ›', color: t.series[0], fontSize: 11.5 },
      }],
      series: [
        {
          type: 'custom',
          id: 'bars',
          data: bars.map((b) => [b.shown.start, b.personIdx, b.shown.end]),
          encode: { x: [0, 2], y: 1 },
          renderItem: (params: any, api: any) => {
            const b = bars[params.dataIndex];
            const p0 = api.coord([b.shown.start, b.personIdx]);
            const p1 = api.coord([b.shown.end, b.personIdx]);
            const band = api.size([0, 1])[1] * 0.78;
            const laneH = band / Math.min(b.laneCount, 12);
            const lane = Math.min(b.lane, 11);
            const y = p0[1] - band / 2 + lane * laneH + 1;
            const h = Math.max(4, laneH - 2);
            const w = Math.max(3, p1[0] - p0[0]);
            const paint = groupPaint(groupKey(b.row.activity_group), t);
            const hovered = store.hoverTour() === b.key;
            const children: any[] = [{
              type: 'rect',
              shape: { x: p0[0], y, width: w, height: h, r: Math.min(4, h / 2) },
              style: { fill: paint.fill, stroke: hovered ? t.ink : (paint.stroke ?? t.surface), lineWidth: hovered ? 2 : 1 },
            }];
            const text = b.row.tourbezeichnung ?? '';
            if (w > 46 && h >= 11) {
              children.push({ type: 'text', style: { x: p0[0] + 5, y: y + h / 2, text, verticalAlign: 'middle',
                fill: paint.stroke != null ? t.ink : inkOn(paint.fill, t), font: `${h >= 14 ? 11.5 : 10}px Segoe UI`, width: w - 8, overflow: 'truncate' } });
            }
            if (b.span.start < b.shown.start || b.span.end > b.shown.end) {
              const ax = b.span.end > b.shown.end ? p1[0] : p0[0];
              const dir = b.span.end > b.shown.end ? 1 : -1;
              children.push({ type: 'polygon', shape: { points: [[ax, y], [ax + 5 * dir, y + h / 2], [ax, y + h]] }, style: { fill: t.ink2 } });
            }
            return { type: 'group', children };
          },
        },
        {
          type: 'line', id: 'clock', data: [], silent: true,
          markLine: clock == null ? undefined : {
            symbol: 'none', silent: true, animation: false,
            lineStyle: { color: t.ink, width: 1.5, type: 'solid' },
            label: { formatter: () => timeLocal(clock), color: t.ink, position: 'end', fontSize: 11 },
            data: [{ xAxis: clock }],
          },
        },
      ],
    };
  });

  protected click(e: { componentType?: string; componentIndex?: number; value?: unknown; seriesId?: string; dataIndex?: number }): void {
    let key: string | null = null;
    if (e.componentType === 'yAxis' && e.componentIndex === 1 && typeof e.value === 'string') {
      void this.router.navigate(['/ac2'], { queryParams: qualLinkParams('RTS', this.store.env(), e.value) });
      return;
    }
    if (e.componentType === 'yAxis' && typeof e.value === 'string') key = e.value;
    else if (e.seriesId === 'bars' && e.dataIndex != null) key = this.rowsKeys()[this.bars()[e.dataIndex].personIdx];
    if (!key || key === this.store.person()) return;
    const rel = this.store.related().find((r) => r.key === key);
    this.store.openPerson(key, rel?.audience);
  }

  protected over(e: { seriesId?: string; dataIndex?: number }): void {
    if (e.seriesId === 'bars' && e.dataIndex != null) this.store.hoverTour.set(this.bars()[e.dataIndex]?.key ?? null);
  }
}
