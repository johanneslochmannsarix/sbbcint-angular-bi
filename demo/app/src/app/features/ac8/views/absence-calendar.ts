import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { dateLong, dayMs, num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac8Colors } from '../data/palette';
import { Ac8Store } from '../data/store';
import { weekday } from '../data/coverage';

const DISP = 'CINT (CH) - Disponent Leitstelle';

/**
 * View 9 - how many people are away per day, against how well the day is covered? Calendar heatmap of
 * [Personen abwesend] per day (kpi query; absence WINDOWS only - no type, no reason, not even with -Real,
 * PLAN §13.3). Overlay ring: SOLL shifts of that weekday (sum of the chosen planning's template measures)
 * minus staffed planned shifts that day ([Anzahl Schichten] with a person), drawn only where it is positive.
 */
@Component({
  selector: 'ac8-absence-calendar',
  imports: [NgxEchartsDirective, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Abwesenheiten und Abdeckung je Tag" [sub]="sub()" [q]="[store.kpiDay, store.soll]">
      <div echarts class="chart" style="height: 250px" [options]="options()!" [theme]="theme.echartsTheme()"></div>
      <div class="legend-inline ac8-legend">
        <span>Fläche: Personen mit einem Abwesenheitsfenster an dem Tag</span>
        <span><i class="key ac8-key-ring" [style.border-color]="gapColor()"></i>Ring: weniger besetzte Schichten als SOLL (Grösse = Fehlbetrag)</span>
      </div>
      <p class="chart-note">Abwesenheiten erscheinen nur als Zeitfenster, ohne Art und ohne Grund.</p>
    </app-card>
  `,
})
export class AbsenceCalendar {
  protected readonly store = inject(Ac8Store);
  protected readonly theme = inject(ThemeService);
  protected readonly gapColor = computed(() => ac8Colors(this.theme.tokens()).gap);

  /** SOLL shifts per weekday of the chosen planning, same worker filter as the page */
  private readonly sollPerDay = computed(() => {
    const w = this.store.worker();
    const out = [0, 0, 0, 0, 0, 0, 0];
    for (const r of this.store.soll.rows()) {
      if (w !== 'alle' && (w === 'disponent') !== (r.worker_type_name === DISP)) continue;
      out[r.weekday_num] += r.soll ?? 0;
    }
    return out;
  });

  private readonly days = computed(() => {
    const soll = this.sollPerDay();
    const stand = this.store.stand.rows()[0];
    const last = stand?.letzter_plantag?.slice(0, 10) ?? '9999';
    return this.store.kpiDay.rows().map((r) => {
      const d = r.von.slice(0, 10);
      const s = soll[weekday(dayMs(d)!)];
      const short = d <= last && this.store.soll.result() ? Math.max(0, s - (r.besetzt ?? 0)) : 0;
      return { d, absent: r.personen_abwesend ?? 0, windows: r.abwesenheiten ?? 0, staffed: r.besetzt ?? 0, soll: s, short };
    });
  });

  protected readonly sub = computed(() => {
    const d = this.days();
    if (!d.length) return '';
    const max = Math.max(...d.map((x) => x.absent));
    const short = d.filter((x) => x.short > 0).length;
    return `bis ${num(max)} Personen gleichzeitig abwesend; ${num(short)} von ${num(d.length)} Tagen mit weniger besetzten Schichten als SOLL`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const c = ac8Colors(t);
    const days = this.days();
    const week = this.store.storyWeek();
    const inWeek = (d: string) => !week || (d >= week.from && d <= week.to);
    const maxAbs = Math.max(1, ...days.map((x) => x.absent));
    const maxShort = Math.max(1, ...days.map((x) => x.short));
    const byDay = new Map(days.map((x) => [x.d, x]));
    return {
      aria: ariaDecal(),
      tooltip: {
        confine: true,
        formatter: (p: { value: [string, number] }) => {
          const x = byDay.get(p.value[0]);
          if (!x) return '';
          return ttHead(dateLong(dayMs(x.d)!)) + ttRow(null, 'Personen abwesend', num(x.absent)) + ttRow(null, 'Abwesenheitsfenster', num(x.windows))
            + ttRow(c.plan, 'besetzte Schichten', num(x.staffed)) + ttRow(null, `SOLL (${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][weekday(dayMs(x.d)!)]})`, num(x.soll))
            + (x.short > 0 ? ttRow(c.gap, 'Fehlbetrag', num(x.short)) : '');
        },
      },
      visualMap: { show: false, seriesIndex: 0, min: 0, max: maxAbs, inRange: { color: [t.seq[0], t.seq[6]] } },
      calendar: {
        range: [this.store.from(), this.store.to()], top: 28, left: 34, right: 12, bottom: 8, cellSize: ['auto', 26],
        dayLabel: { firstDay: 1, nameMap: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], color: t.muted }, monthLabel: { nameMap: 'DE', color: t.ink2 }, yearLabel: { show: false },
        itemStyle: { borderColor: t.surface, borderWidth: 2, color: t.grid }, splitLine: { lineStyle: { color: t.axis, width: 1 } },
      },
      series: [
        { type: 'heatmap', coordinateSystem: 'calendar', data: days.map((x) => ({ value: [x.d, x.absent], itemStyle: { opacity: inWeek(x.d) ? 1 : 0.3 } })) },
        {
          type: 'scatter', coordinateSystem: 'calendar', z: 3, silent: true,
          data: days.filter((x) => x.short > 0).map((x) => ({ value: [x.d, x.short], itemStyle: { opacity: inWeek(x.d) ? 1 : 0.3 } })),
          symbol: 'emptyCircle', symbolSize: (v: [string, number]) => 6 + 14 * Math.sqrt(v[1] / maxShort),
          itemStyle: { color: c.gap, borderColor: c.gap, borderWidth: 2 },
        },
      ],
    };
  });
}
