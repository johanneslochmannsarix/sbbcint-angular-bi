import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { DataStore, Person, label } from '../data/model';
import { SelectionService } from '../data/selection';
import { ThemeService } from '../data/theme';
import { num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { barStyle, legendTop, ttHead, ttRow } from '../../../shared/chart-opts';

const LIST_CAP = 200;

/**
 * View 5 — the figure SBBCBI-93 asks for («Anzahl fehlender Qualifikationen je Person»). Gap = no row other
 * than MISSING_NEVER; optionally EXPIRED counts too. Stacked by "has a name" so the nameless CC people
 * (QDASH-8) are visible as such, not hidden. Click a bar for the people in it.
 */
@Component({
  selector: 'app-histogram',
  imports: [NgxEchartsDirective, ChartResize, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Fehlende Qualifikationen je Person" [sub]="sub()" [q]="store.modelQueries" [forceEmpty]="!!store.model() && sel.people().length === 0">
      <div card-tools class="seg seg-sm" role="group" aria-label="Was als Lücke zählt">
        <button type="button" [attr.aria-pressed]="!withExpired()" (click)="withExpired.set(false)">Nur «Fehlt»</button>
        <button type="button" [attr.aria-pressed]="withExpired()" (click)="withExpired.set(true)">«Fehlt» + abgelaufen</button>
      </div>
      <div echarts class="chart h-300" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="pick($any($event))"></div>
      @if (bin() != null) {
        <section class="bin" aria-live="polite">
          <header class="bin-head">
            <h3>{{ num(binPeople().length) }} Personen mit {{ bin() }} {{ withExpired() ? 'Lücken (inkl. abgelaufen)' : 'fehlenden Qualifikationen' }}</h3>
            <button type="button" class="btn btn-ghost" (click)="bin.set(null)">Schliessen</button>
          </header>
          @if (binPeople().length > cap) { <p class="muted">Die ersten {{ cap }} von {{ num(binPeople().length) }}.</p> }
          <ul class="plist">
            @for (p of binPeople().slice(0, cap); track p.key) {
              <li>
                <button type="button" class="linkish" (click)="sel.person.set(p.key)">{{ name(p) }}</button>
                <span class="muted">{{ gapText(p) }}</span>
              </li>
            }
          </ul>
        </section>
      }
    </app-card>
  `,
  styles: [`
    .bin { border-top: 1px solid var(--rule); margin-top: 8px; padding-top: 8px; }
    .bin-head { display: flex; justify-content: space-between; align-items: center; }
    .bin-head h3 { font-size: 14px; }
    .plist { list-style: none; margin: 6px 0 0; padding: 0; max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
    .plist li { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  `],
})
export class HistogramView {
  protected readonly store = inject(DataStore);
  protected readonly sel = inject(SelectionService);
  protected readonly theme = inject(ThemeService);
  protected readonly num = num;
  protected readonly cap = LIST_CAP;

  protected readonly withExpired = signal(false);
  protected readonly bin = linkedSignal<unknown, number | null>({ source: () => [this.sel.people(), this.withExpired()], computation: () => null });

  private gapsOf(p: Person): number {
    return p.gaps + (this.withExpired() ? p.expired : 0);
  }

  private readonly hist = computed(() => {
    const m = this.store.model();
    const n = m?.quals.length ?? 0;
    const named = new Array(n + 1).fill(0);
    const nameless = new Array(n + 1).fill(0);
    const all = new Array(n + 1).fill(0);
    for (const p of m?.persons ?? []) all[this.gapsOf(p)]++;
    for (const p of this.sel.people()) (p.name == null ? nameless : named)[this.gapsOf(p)]++;
    return { n, named, nameless, all };
  });

  protected readonly sub = computed(() => {
    const ppl = this.sel.people();
    if (!ppl.length) return '';
    const g = ppl.map((p) => this.gapsOf(p)).sort((a, b) => a - b);
    const median = g[Math.floor(g.length / 2)];
    const zero = g.filter((x) => x === 0).length;
    const all = this.store.model()?.persons.length ?? 0;
    return `${num(ppl.length)} Personen${this.sel.active() ? ` in der Auswahl (von ${num(all)})` : ''}; Median ${median} von ${this.hist().n}, ${num(zero)} ohne Lücke`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const m = this.store.model();
    if (!m) return null;
    const t = this.theme.tokens();
    const h = this.hist();
    const cats = Array.from({ length: h.n + 1 }, (_, i) => String(i));
    const anyNameless = h.nameless.some((v) => v > 0);
    const series: unknown[] = [
      { name: 'Personen mit Namen', type: 'bar', stack: 'p', barCategoryGap: '18%', data: h.named, itemStyle: { color: t.ink2 } },
    ];
    if (anyNameless) {
      series.push({ name: 'ohne Namen im Export (QDASH-8)', type: 'bar', stack: 'p', data: h.nameless, itemStyle: { ...barStyle(t.noName, false) } });
    }
    // no "everyone" overlay while a selection is active: one y scale cannot show 17 next to 1'300, and a
    // second y axis is not an option (dataviz rule); the subtitle names the population instead
    // round only the top segment of the stack
    (series[anyNameless ? 1 : 0] as { itemStyle: object }).itemStyle = { ...(series[anyNameless ? 1 : 0] as { itemStyle: object }).itemStyle, borderRadius: [3, 3, 0, 0] };
    return {
      animation: false,
      legend: { ...legendTop(t), show: series.length > 1 },
      grid: { left: 8, right: 12, top: 34, bottom: 8, outerBounds: { left: 8, right: 12, top: 34, bottom: 8 } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: { dataIndex: number; seriesName: string; value: number; color: string }[]) =>
          ttHead(`${ps[0].dataIndex} ${this.withExpired() ? 'Lücken' : 'fehlende Qualifikationen'}`)
          + ps.map((p) => ttRow(p.color, p.seriesName, num(p.value))).join('') + '<div style="opacity:.7;margin-top:4px">Klicken für die Personen</div>',
      },
      xAxis: { type: 'category', data: cats, name: 'fehlende Qualifikationen', nameLocation: 'middle', nameGap: 26, axisLabel: { interval: h.n > 40 ? 9 : 4 } },
      yAxis: { type: 'value', name: 'Personen', nameTextStyle: { align: 'left' }, minInterval: 1 },
      series,
    };
  });

  protected pick(e: { dataIndex?: number }): void {
    if (e.dataIndex != null) this.bin.set(e.dataIndex);
  }

  protected readonly binPeople = computed(() => {
    const b = this.bin();
    if (b == null) return [];
    return this.sel.people().filter((p) => this.gapsOf(p) === b).sort((a, c) => a.key.localeCompare(c.key));
  });

  protected name(p: Person): string {
    return label(p, this.store.masked());
  }
  protected gapText(p: Person): string {
    const m = this.store.model();
    if (!m) return '';
    const missing = m.quals.filter((q) => !p.cells.has(q.sk) || (this.withExpired() && p.cells.get(q.sk)!.status === 'EXPIRED')).map((q) => q.name);
    if (!missing.length) return 'keine Lücke';
    if (missing.length === m.quals.length) return 'hält keine Qualifikation';
    return missing.length <= 4 ? missing.join(', ') : `${missing.slice(0, 4).join(', ')} … +${missing.length - 4}`;
  }
}
