import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { personText } from '../../../core/api';
import { ThemeService } from '../../../core/theme';
import { BLANK, dateShort, dateTimeLU, localMs, num, timeLocal } from '../../../core/format';
import { FONT_NUM } from '../../../core/tokens';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { PseudonymChip } from '../../../shared/pseudonym-chip';
import { QualLink } from '../../../shared/qual-link';
import { ac8Colors } from '../data/palette';
import { Ac8Store } from '../data/store';

/**
 * View 7 - how did one shift evolve, and which version is the communicated one? Top lane: every version
 * along created_ts, each valid until the next one is created. Below: the content of each version (shift
 * start - end, person) against the current plan. The pointer version (fact_shift current_snapshot_sk =
 * communicated, ADR-049) wears a heavy outline; the version the duty plan shows (rule v3) is tagged. With an
 * empty pointer the duty plan shows the newest version: CCL-3 assumption (a).
 */
@Component({
  selector: 'ac8-version-timeline',
  imports: [NgxEchartsDirective, ChartCard, PseudonymChip, QualLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'ac8-versionen' },
  template: `
    <app-card heading="Versionsverlauf einer Schicht" [sub]="sub()" [q]="store.shiftVersions" idleText="Noch keine Schicht gewählt.">
      <div card-tools class="ac8-tools">
        @if (planPerson(); as p) { <span class="muted">jetzt eingeteilt</span> <app-pseudonym [person]="p" /> <app-qual-link [person]="p.key" tenant="CARGOCONTROL" [env]="store.env()" /> }
        @if (store.shift()) { <button type="button" class="btn btn-ghost" (click)="store.shift.set(null)">Schicht mit den meisten Versionen</button> }
      </div>
      <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()"></div>
      <p class="chart-note">{{ note() }}</p>
    </app-card>
  `,
})
export class VersionTimeline {
  protected readonly store = inject(Ac8Store);
  protected readonly theme = inject(ThemeService);

  private readonly versions = computed(() =>
    [...this.store.shiftVersions.rows()].sort((a, b) => (localMs(a.created_ts) ?? 0) - (localMs(b.created_ts) ?? 0) || a.version_nr - b.version_nr));
  protected readonly height = computed(() => 120 + (this.versions().length + 1) * 26);
  protected readonly planPerson = computed(() => this.store.person$(this.versions()[0]?.plan_person_sk ?? null));

  protected readonly sub = computed(() => {
    const v = this.versions();
    if (!v.length) return '';
    const persons = new Set(v.map((x) => x.person_sk ?? '–')).size;
    const ks = v[0].kommunikationsstand ?? 'nicht mehr im Plan';
    return `${num(v.length)} Versionen, ${persons > 1 ? `${persons} verschiedene Personen` : 'immer dieselbe Person'}; heute: ${ks}${v[0].dienstplan_quelle ? `, Dienstplan: ${v[0].dienstplan_quelle}` : ''}`;
  });
  protected readonly note = computed(() => {
    const v = this.versions();
    if (!v.length) return '';
    if (v.some((x) => x.ist_pointer)) return 'Dicker Rahmen: die Version, auf die der Pointer zeigt (= kommuniziert). Die jüngste Version ist nicht automatisch die kommunizierte.';
    if (v.some((x) => x.ist_dienstplan)) return 'Pointer leer: der Dienstplan zeigt die jüngste Version. Annahme CCL-3 (a), nur durch Rücktest gestützt, bei SaxMS offen.';
    return 'Diese Schicht steht auf keinem Dienstplan (nie kommuniziert oder vergangen).';
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const c = ac8Colors(t);
    const v = this.versions();
    if (!v.length) return { series: [] };
    const now = Date.now();
    const cats = ['Plan heute', ...v.map((x) => `V${x.version_nr}`)];
    const rmColor = (l: string | null) => c.rueckmeldung[l ?? 'keine Rückmeldung'] ?? t.neutral;
    const lane = v.map((x, i) => [localMs(x.created_ts) ?? now, i + 1 < v.length ? localMs(v[i + 1].created_ts) ?? now : now, i]);
    const rows = v.map((x, i) => [localMs(x.snapshot_start) ?? 0, localMs(x.snapshot_end) ?? 0, i + 1, i]);
    const ps = localMs(v[0].plan_start), pe = localMs(v[0].plan_ende);
    const plan = ps != null && pe != null ? [[ps, pe, 0, -1]] : [];
    const who = (k: string | null) => { const p = this.store.person$(k); return p ? personText(p) : 'unbesetzt'; };
    const tip = (i: number) => {
      if (i < 0) return ttHead('aktueller Plan') + ttRow(c.plan, 'Zeit', `${dateShort(ps!)} ${timeLocal(ps!)}–${timeLocal(pe!)}`) + ttRow(null, 'Person', who(v[0].plan_person_sk));
      const x = v[i];
      const s = localMs(x.snapshot_start), e = localMs(x.snapshot_end);
      return ttHead(`Version ${x.version_nr}${x.ist_pointer ? ' (Pointer = kommuniziert)' : ''}${x.ist_dienstplan ? ', im Dienstplan' : ''}`)
        + ttRow(null, 'erstellt', dateTimeLU(localMs(x.created_ts)))
        + ttRow(null, 'Inhalt', s != null && e != null ? `${dateShort(s)} ${timeLocal(s)}–${timeLocal(e)}` : BLANK)
        + ttRow(null, 'Person', who(x.person_sk)) + ttRow(rmColor(x.rueckmeldung_status_label), 'Rückmeldung', x.rueckmeldung_status_label ?? 'keine')
        + ttRow(null, 'Typcode (unentschlüsselt)', String(x.snapshot_type_code ?? BLANK));
    };
    type Api = { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] };
    const box = (api: Api, y: number, h: number) => {
      const a = api.coord([api.value(0), y]);
      const b = api.coord([api.value(1), y]);
      return { x: a[0], y: a[1] - h / 2, width: Math.max(3, b[0] - a[0]), height: h };
    };
    return {
      animationDurationUpdate: 500,
      aria: ariaDecal(),
      tooltip: { trigger: 'item', confine: true, formatter: (p: { value: number[]; seriesIndex: number }) => tip(p.seriesIndex === 0 ? p.value[2] : p.value[3]) },
      grid: [{ left: 96, right: 200, top: 22, height: 30 }, { left: 96, right: 200, top: 92, bottom: 26 }],
      xAxis: [
        { gridIndex: 0, type: 'time', name: 'gültig ab Erstellung', nameLocation: 'start', nameGap: 8, nameTextStyle: { color: t.muted, align: 'right' }, axisLabel: { color: t.muted, fontSize: 10.5 }, splitLine: { show: false } },
        { gridIndex: 1, type: 'time', axisLabel: { color: t.muted, fontSize: 10.5 }, splitLine: { show: true, lineStyle: { color: t.grid } } },
      ],
      yAxis: [
        { gridIndex: 0, type: 'category', data: ['Versionen'], axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false } },
        { gridIndex: 1, type: 'category', data: cats, inverse: true, axisTick: { show: false }, axisLabel: { color: t.ink2, fontFamily: FONT_NUM } },
      ],
      series: [
        {
          type: 'custom', xAxisIndex: 0, yAxisIndex: 0, data: lane, encode: { x: [0, 1], y: 2 },
          renderItem: (_: unknown, api: Api) => {
            const x = v[api.value(2)];
            const r = box(api, 0, 22);
            return { type: 'group', children: [
              { type: 'rect', shape: { ...r, r: 2 }, style: { fill: rmColor(x.rueckmeldung_status_label), stroke: x.ist_pointer ? t.ink : t.surface, lineWidth: x.ist_pointer ? 3 : 1 } },
              { type: 'text', x: r.x + 4, y: r.y + 11, style: { text: r.width > 26 ? `V${x.version_nr}` : '', fill: t.ink, font: `11px ${FONT_NUM}`, verticalAlign: 'middle' } },
            ] };
          },
        },
        {
          type: 'custom', xAxisIndex: 1, yAxisIndex: 1, data: [...plan, ...rows], encode: { x: [0, 1], y: 2 },
          renderItem: (_: unknown, api: Api) => {
            const i = api.value(3);
            const r = box(api, api.value(2), 16);
            if (i < 0) return { type: 'rect', shape: { ...r, r: 2 }, style: { fill: c.plan } };
            const x = v[i];
            const tags = [x.ist_pointer ? 'Pointer = kommuniziert' : '', x.ist_dienstplan ? 'Dienstplan zeigt' : ''].filter(Boolean).join(', ');
            return { type: 'group', children: [
              { type: 'rect', shape: { ...r, r: 2 }, style: { fill: rmColor(x.rueckmeldung_status_label), stroke: x.ist_pointer ? t.ink : 'transparent', lineWidth: x.ist_pointer ? 2.5 : 0, opacity: x.schicht_im_plan === false ? 0.5 : 1 } },
              { type: 'text', x: r.x + r.width + 6, y: r.y + 8, style: { text: `${who(x.person_sk)}${tags ? `   ${tags}` : ''}`, fill: x.ist_pointer || x.ist_dienstplan ? t.ink : t.muted, font: `${x.ist_pointer ? 600 : 400} 11px ${FONT_NUM}`, verticalAlign: 'middle' } },
            ] };
          },
        },
      ],
    };
  });
}
