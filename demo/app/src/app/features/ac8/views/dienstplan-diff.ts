import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { personText } from '../../../core/api';
import { ThemeService } from '../../../core/theme';
import { BLANK, addDays, dateShort, dayMs, localMs, num, timeLocal, today } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, esc, ttHead, ttRow } from '../../../shared/chart-opts';
import { DIENSTPLAN_QUELLEN, DienstplanRow } from '../data/types';
import { DECAL, ac8Colors, quelleShort, standColor } from '../data/palette';
import { Ac8Store } from '../data/store';

type Delta = 'verschoben' | 'Dauer' | 'andere Person' | 'gelöscht' | 'entfernt';
const GLYPH: Record<Delta, string> = { verschoben: '⇄', Dauer: '↔', 'andere Person': '⇅', gelöscht: '✕', entfernt: '⊘' };
const MIN = 60_000;

/** The delta between what the employee was last told and the current plan, from the returned columns. */
function deltas(r: DienstplanRow): Delta[] {
  if (r.dienstplan_quelle.startsWith('gelöscht')) return ['gelöscht'];
  if (r.dienstplan_quelle.startsWith('Person entfernt')) return ['entfernt'];
  const out: Delta[] = [];
  const ds = localMs(r.dienstplan_start), de = localMs(r.dienstplan_ende), ps = localMs(r.plan_start), pe = localMs(r.plan_ende);
  if (ds != null && ps != null && Math.abs(ds - ps) >= MIN) out.push('verschoben');
  if (ds != null && de != null && ps != null && pe != null && Math.abs((de - ds) - (pe - ps)) >= MIN) out.push('Dauer');
  if (r.plan_person_sk && r.person_sk && r.plan_person_sk !== r.person_sk) out.push('andere Person');
  return out;
}

/**
 * View 6 - what does the employee see, and what is the real state (Dario's CCL-1 question)? Rows = people
 * (pseudonyms). Per roster row of fact_dienstplan (ADR-051 rule v3): the communicated version as an outline
 * on the row of the person who was told, the current plan as a filled bar on the row of the person who now
 * holds it, a glyph for the delta (⇄ shifted, ↔ other length, ⇅ other person with a connector, ✕ deleted,
 * ⊘ person removed). «vorheriger Stand» rests on CCL-3 assumption (a): once the pointer is cleared, the
 * newest version is taken as the last communicated one (back-test only, open under SAX-33).
 */
@Component({
  selector: 'ac8-dienstplan-diff',
  imports: [NgxEchartsDirective, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Dienstplan: kommuniziert gegen aktueller Plan" [sub]="sub()" [q]="[store.dienstplan, store.persons]">
      <div card-tools class="ac8-tools">
        <div class="seg seg-sm" role="group" aria-label="Zeilen">
          <button type="button" [attr.aria-pressed]="rows() === 'abweichung'" (click)="rows.set('abweichung')">Nur Abweichungen</button>
          <button type="button" [attr.aria-pressed]="rows() === 'alle'" (click)="rows.set('alle')">Alle Personen</button>
        </div>
      </div>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"></div>
      <div class="legend-inline ac8-legend">
        <span><i class="key ac8-key-outline"></i>Dienstplan (zuletzt mitgeteilt)</span>
        <span><i class="key" [style.background]="colors().plan"></i>aktueller Plan</span>
        @for (q of quellen; track q) { <span><i class="key" [style.background]="quelleColor(q)"></i>{{ short(q) }}</span> }
        <span class="ac8-glyphs">⇄ verschoben ↔ andere Dauer ⇅ andere Person ✕ gelöscht ⊘ Person entfernt</span>
      </div>
      <p class="chart-note">«vorheriger Stand» beruht auf Annahme CCL-3 (a): ist der Pointer geleert, gilt die jüngste Version als zuletzt mitgeteilt (nur Rücktest, offen bei SaxMS). «gelöscht» und «Person entfernt»: ob das der Person mitgeteilt wurde, ist nicht nachweisbar; sie bleiben bis zum Schichttag stehen. Name anklicken hebt die Person hervor, Balken anklicken öffnet den Versionsverlauf.</p>
    </app-card>
  `,
})
export class DienstplanDiff {
  protected readonly store = inject(Ac8Store);
  protected readonly theme = inject(ThemeService);
  protected readonly rows = signal<'abweichung' | 'alle'>('abweichung');
  protected readonly colors = computed(() => ac8Colors(this.theme.tokens()));
  protected readonly quellen = DIENSTPLAN_QUELLEN;
  protected quelleColor(q: string): string { return standColor(this.colors(), q); }
  protected short(q: string): string { return quelleShort(q); }

  private readonly lines = computed(() => {
    const focus = this.store.focus();
    const want = focus === 'geändert, nicht kommuniziert' ? 'vorheriger' : focus === 'gelöscht' ? 'gelöscht' : focus === 'unbesetzt' ? 'Person entfernt' : null;
    return this.store.dienstplan.rows()
      .map((r) => ({ r, d: deltas(r) }))
      .filter(({ r, d }) => (this.rows() === 'alle' || d.length > 0 || r.dienstplan_quelle !== 'kommuniziert') && (!want || r.dienstplan_quelle.startsWith(want)));
  });

  private readonly people = computed(() => {
    const n = new Map<string, number>();
    for (const { r, d } of this.lines()) {
      for (const p of [r.person_sk, r.plan_person_sk]) if (p) n.set(p, (n.get(p) ?? 0) + (d.length ? 1 : 0));
    }
    const label = (k: string) => { const p = this.store.person$(k); return p ? personText(p) : k; };
    return [...n].sort((a, b) => b[1] - a[1] || label(a[0]).localeCompare(label(b[0]))).map(([k]) => k);
  });
  protected readonly height = computed(() => Math.min(620, Math.max(260, this.people().length * 20 + 90)));

  protected readonly sub = computed(() => {
    const all = this.store.dienstplan.rows();
    if (!this.store.dienstplan.result()) return '';
    const dev = this.lines().filter((l) => l.d.length).length;
    return `${num(all.length)} Zeilen im Dienstplan, ${num(dev)} mit Abweichung zum aktuellen Plan, ${num(this.people().length)} Personen gezeigt`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const c = this.colors();
    const people = this.people();
    const idx = new Map(people.map((p, i) => [p, i]));
    const lines = this.lines();
    const sel = this.store.person();
    const shift = this.store.shift();
    const week = this.store.storyWeek();
    const data = lines.map(({ r, d }, i) => [
      localMs(r.dienstplan_start) ?? dayMs(r.dienstplan_datum), localMs(r.dienstplan_ende) ?? dayMs(r.dienstplan_datum)! + 3_600_000,
      r.person_sk ? idx.get(r.person_sk) ?? -1 : -1, localMs(r.plan_start) ?? -1, localMs(r.plan_ende) ?? -1,
      r.plan_person_sk ? idx.get(r.plan_person_sk) ?? -1 : -1, i, d.length,
    ]);
    const label = (k: string) => { const p = this.store.person$(k); return p ? personText(p) : k; };
    const zoomFrom = week ? dayMs(week.from)! : Math.max(dayMs(this.store.from())!, addDays(today(), -3));
    const zoomTo = week ? dayMs(week.to)! + 86_400_000 : addDays(zoomFrom, 14);
    const visible = Math.min(people.length, 24);
    return {
      animation: false,
      aria: ariaDecal(), // the state is an outline colour + glyph; deletion carries its own hatch
      grid: { left: 132, right: 16, top: 8, bottom: 44 },
      dataZoom: [
        { type: 'slider', xAxisIndex: 0, height: 16, bottom: 6, startValue: zoomFrom, endValue: zoomTo, filterMode: 'weakFilter', labelFormatter: dateShort },
        { type: 'inside', xAxisIndex: 0, filterMode: 'weakFilter' },
        { type: 'slider', yAxisIndex: 0, width: 10, right: 2, startValue: 0, endValue: Math.max(0, visible - 1), showDetail: false, filterMode: 'empty' },
        { type: 'inside', yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: true, moveOnMouseMove: false },
      ],
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: { dataIndex: number }) => {
          const { r, d } = lines[p.dataIndex];
          const hm = (s: string | null, e: string | null) => { const a = localMs(s), z = localMs(e); return a != null && z != null ? `${dateShort(a)} ${timeLocal(a)}–${timeLocal(z)}` : BLANK; };
          const pp = r.plan_person_sk ? this.store.person$(r.plan_person_sk) : null;
          return ttHead(r.dienstplan_quelle) + ttRow(null, 'Schicht', r.shift_name ?? BLANK) + ttRow(null, 'Dienstplan zeigt', hm(r.dienstplan_start, r.dienstplan_ende))
            + ttRow(null, 'aktueller Plan', r.schicht_im_plan ? hm(r.plan_start, r.plan_ende) : 'nicht mehr im Plan')
            + ttRow(null, 'jetzt eingeteilt', pp ? personText(pp) : 'niemand')
            + (d.length ? ttRow(null, 'Abweichung', d.map((x) => `${GLYPH[x]} ${x}`).join(', ')) : '')
            + (r.dienstplan_quelle.startsWith('vorheriger') ? `<div style="margin-top:4px;color:${t.muted}">${esc('Annahme CCL-3 (a)')}</div>` : '');
        },
      },
      xAxis: { type: 'time', position: 'top', axisLabel: { color: t.muted }, splitLine: { show: true, lineStyle: { color: t.grid } } },
      yAxis: {
        type: 'category', data: people, inverse: true, triggerEvent: true,
        axisLabel: { color: t.ink2, fontFamily: FONT_NUM, fontSize: 11.5, formatter: (k: string) => (k === sel ? `{sel|${label(k)}}` : label(k)), rich: { sel: { fontWeight: 700, color: t.ink } } },
        splitLine: { show: true, lineStyle: { color: t.grid } }, axisTick: { show: false },
      },
      series: [{
        type: 'custom', progressive: 3000, clip: true, data,
        encode: { x: [0, 1], y: 2 },
        renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const i = api.value(6);
          const { r, d } = lines[i];
          const band = api.size([0, 1])[1];
          const kids: object[] = [];
          const qc = standColor(c, r.dienstplan_quelle);
          const hit = shift === r.shift_sk;
          const yRow = api.value(2);
          let ax = 0, ay = 0;
          if (yRow >= 0) {
            const a = api.coord([api.value(0), yRow]);
            const b = api.coord([api.value(1), yRow]);
            ax = a[0]; ay = a[1];
            const h = band * 0.72;
            kids.push({
              type: 'rect', shape: { x: a[0], y: a[1] - h / 2, width: Math.max(2, b[0] - a[0]), height: h, r: 2 },
              style: { fill: r.dienstplan_quelle.startsWith('gelöscht') ? qc : 'transparent', opacity: 1, stroke: qc, lineWidth: hit ? 2.5 : 1.5,
                decal: r.dienstplan_quelle.startsWith('gelöscht') ? DECAL.geloescht : undefined },
            });
            if (d.length) {
              kids.push({ type: 'text', x: a[0], y: a[1] - h / 2 - 1, style: { text: d.map((x) => GLYPH[x]).join(''), fill: t.ink, font: `600 11px ${FONT_NUM}`, verticalAlign: 'bottom' } });
            }
          }
          const pRow = api.value(5);
          if (pRow >= 0 && api.value(3) > 0) {
            const a = api.coord([api.value(3), pRow]);
            const b = api.coord([api.value(4), pRow]);
            const h = band * 0.36;
            kids.push({ type: 'rect', shape: { x: a[0], y: a[1] - h / 2, width: Math.max(2, b[0] - a[0]), height: h, r: 1.5 }, style: { fill: c.plan, opacity: 0.9 } });
            if (yRow >= 0 && pRow !== yRow) {
              kids.push({ type: 'line', shape: { x1: ax, y1: ay, x2: a[0], y2: a[1] }, style: { stroke: c.entfernt, lineWidth: 1, lineDash: [3, 2] } });
            }
          }
          return { type: 'group', children: kids };
        },
      }],
    };
  });

  protected click(e: { componentType?: string; value?: unknown; dataIndex?: number; seriesType?: string }): void {
    if (e.componentType === 'yAxis' && typeof e.value === 'string') {
      this.store.person.set(this.store.person() === e.value ? null : e.value);
      return;
    }
    if (e.seriesType === 'custom' && e.dataIndex != null) {
      const l = this.lines()[e.dataIndex];
      if (l) {
        this.store.shift.set(l.r.shift_sk);
        document.getElementById('ac8-versionen')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}
