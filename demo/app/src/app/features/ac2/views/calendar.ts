import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { DataStore, ExpiryRow } from '../data/model';
import { createQuery } from '../data/query';
import { SelectionService } from '../data/selection';
import { ThemeService } from '../data/theme';
import { addMonths, dateLong, dayMs, isoDay, num, today } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { ttHead, ttRow } from '../../../shared/chart-opts';

const DAY = 86_400_000;

/**
 * View 2 (extends the matrix column «Gültig bis»). Day counts come from the loaded pairs, filtered by the
 * shared selection; the list for a clicked day comes from the backend (`expiries`, date window = that day,
 * optional focus qualification) so it carries the qualification names and the status as the model has them.
 */
@Component({
  selector: 'app-calendar',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wann laufen Qualifikationen ab" [sub]="sub()" [q]="store.modelQueries"
      [forceEmpty]="!!store.model() && total() === 0" [emptyNote]="'Keine Qualifikation läuft in den nächsten ' + months() + ' Monaten ab' + (sel.active() ? ' (in der Auswahl).' : '.')">
      <div card-tools class="seg seg-sm" role="group" aria-label="Zeitraum">
        @for (n of [3, 6, 12]; track n) {
          <button type="button" [attr.aria-pressed]="months() === n" (click)="months.set(n)">{{ n }} Monate</button>
        }
      </div>
      <div class="cal-layout">
        <div echarts class="chart" [style.height.px]="height()" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="pick($any($event))"></div>
        <aside class="day-panel" aria-live="polite">
          @if (day(); as d) {
            <header class="day-head">
              <h3>{{ dateLong(d) }}</h3>
              <button type="button" class="btn btn-ghost" (click)="day.set(null)">Schliessen</button>
            </header>
            @if (list.loading() && !list.result()) {
              <p class="muted"><span class="spinner"></span> Lädt</p>
            } @else if (list.error(); as e) {
              <p class="muted">Liste nicht verfügbar: {{ e.message }}</p>
            } @else {
              <p class="muted">{{ listRows().length }} Abläufe{{ sel.active() ? ' in der Auswahl' : '' }}{{ focusName() ? ', nur ' + focusName() : '' }}{{ hiddenBySel() ? ' (' + hiddenBySel() + ' ausserhalb der Auswahl)' : '' }}</p>
              <ul class="plist">
                @for (r of listRows(); track $index) {
                  <li>
                    <button type="button" class="linkish" (click)="sel.person.set(r.person_sk)">{{ r.person_name ?? (r.person_sk + ' (ohne Namen)') }}</button>
                    <span class="muted">{{ r.qualification_name }}@if (r.tenant_name) { · {{ r.tenant_name }} }</span>
                  </li>
                } @empty {
                  <li class="muted">Keine Zeilen unter diesem Filter.</li>
                }
              </ul>
            }
          } @else {
            <p class="muted hint-box">Tag anklicken: die Personen, deren Qualifikation an diesem Tag abläuft (pseudonymisiert, solange das Backend nicht mit -Real läuft).</p>
          }
        </aside>
      </div>
    </app-card>
  `,
  styles: [`
    .cal-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; }
    .day-panel { border-left: 1px solid var(--rule); padding-left: 14px; min-height: 120px; max-height: 420px; overflow: auto; }
    .day-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .day-head h3 { font-size: 14px; }
    .plist { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .plist li { display: flex; flex-direction: column; }
    .hint-box { margin-top: 8px; }
    @media (max-width: 900px) { .cal-layout { grid-template-columns: minmax(0, 1fr); } .day-panel { border-left: 0; padding-left: 0; } }
  `],
})
export class CalendarView {
  protected readonly store = inject(DataStore);
  protected readonly sel = inject(SelectionService);
  protected readonly theme = inject(ThemeService);
  protected readonly dateLong = dateLong;

  protected readonly months = signal(6);
  protected readonly day = signal<number | null>(null);

  private readonly window = computed(() => {
    const from = today();
    return { from, to: addMonths(from, this.months()) - DAY };
  });

  private readonly counts = computed(() => {
    const { from, to } = this.window();
    const map = new Map<number, number>();
    const focus = this.sel.qualification();
    for (const p of this.sel.people()) {
      for (const [qsk, c] of p.cells) {
        if (focus && qsk !== focus) continue;
        if (c.to != null && c.to >= from && c.to <= to) map.set(c.to, (map.get(c.to) ?? 0) + 1);
      }
    }
    return map;
  });
  protected readonly total = computed(() => [...this.counts().values()].reduce((a, b) => a + b, 0));
  protected readonly sub = computed(() =>
    `${num(this.total())} Abläufe in den nächsten ${this.months()} Monaten${this.sel.active() ? ', nur ausgewählte Personen (' + this.sel.brushLabel() + ')' : ''}${this.focusName() ? ', nur ' + this.focusName() : ''}`);

  protected readonly height = computed(() => (this.months() <= 3 ? 190 : 200));

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    if (!this.store.model()) return null;
    const t = this.theme.tokens();
    const { from, to } = this.window();
    const counts = this.counts();
    const max = Math.max(1, ...counts.values());
    return {
      animation: false,
      tooltip: {
        formatter: (p: { value: [string, number] }) => ttHead(dateLong(dayMs(p.value[0])!)) + ttRow(null, 'Abläufe', num(p.value[1])) + '<div style="opacity:.7;margin-top:4px">Klicken für die Liste</div>',
      },
      visualMap: {
        type: 'continuous', min: 0, max, calculable: false, orient: 'horizontal', right: 0, bottom: 0, itemHeight: 120, itemWidth: 10,
        inRange: { color: [t.seq[0], t.seq[t.seq.length - 1]] }, text: [num(max), '1'], textStyle: { color: t.muted },
      },
      calendar: {
        range: [isoDay(from), isoDay(to)], top: 26, left: 34, right: 8, bottom: 34, cellSize: ['auto', 18],
        splitLine: { show: true, lineStyle: { color: t.axis, width: 1 } },
        itemStyle: { color: t.surface, borderColor: t.grid, borderWidth: 1 },
        dayLabel: { firstDay: 1, nameMap: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], color: t.muted, fontSize: 10 },
        monthLabel: { nameMap: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'], color: t.ink2, fontSize: 11 },
        yearLabel: { show: false },
      },
      series: [{
        type: 'heatmap', coordinateSystem: 'calendar',
        data: [...counts.entries()].map(([ms, n]) => [isoDay(ms), n]),
        itemStyle: { borderColor: t.surface, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } },
      }],
    };
  });

  protected pick(e: { value?: [string, number] }): void {
    const ms = e.value ? dayMs(e.value[0]) : null;
    if (ms != null) this.day.set(ms);
  }

  protected readonly focusName = computed(() => {
    const q = this.sel.qualification();
    return q ? (this.store.model()?.qualBySk.get(q)?.name ?? null) : null;
  });

  protected readonly list = createQuery<ExpiryRow>(() => {
    const d = this.day();
    if (d == null) return null;
    const q = this.sel.qualification();
    return { name: 'expiries', params: { ...this.store.base(), date_from: isoDay(d), date_to: isoDay(d), ...(q ? { qualification: q } : {}) } };
  });
  protected readonly listRows = computed(() => {
    const b = this.sel.brushed();
    return this.list.rows().filter((r) => !b || b.has(r.person_sk));
  });
  protected readonly hiddenBySel = computed(() => this.list.rows().length - this.listRows().length);
}
