import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { addDays, dateShort, dayMs, isoDay, num } from '../../../core/format';
import { ChartCard } from '../../../shared/chart-card';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { ac8Colors } from '../data/palette';
import { Ac8Store } from '../data/store';

const RM_ORDER = ['automatisch akzeptiert', 'akzeptiert', 'versendet', 'abgelehnt', 'veraltet', 'keine Rückmeldung'];

/**
 * View 4 - when does the Leitstelle change how much? themeRiver of versions per creation day (river query,
 * a row count of fact_shift_snapshot), by Rückmeldung or by Erstversion / Änderung. The type and category
 * codes of the snapshot are not used: category is always 0, type is undecoded (SAX-34). Follows the brush of
 * the lead-time scatter. Days without a version in a category are padded with 0 (themeRiver needs a value
 * per day and series) - layout, not a count.
 */
@Component({
  selector: 'ac8-river',
  imports: [NgxEchartsDirective, ChartCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Änderungsfluss" [sub]="sub()" [q]="store.river">
      <div card-tools class="seg seg-sm" role="group" aria-label="Aufteilung">
        <button type="button" [attr.aria-pressed]="store.riverSerie() === 'status'" (click)="store.riverSerie.set('status')">Rückmeldung</button>
        <button type="button" [attr.aria-pressed]="store.riverSerie() === 'art'" (click)="store.riverSerie.set('art')">Erst / Änderung</button>
      </div>
      <div echarts class="chart" style="height: 300px" [options]="options()!" [theme]="theme.echartsTheme()"></div>
      <p class="chart-note">Versionen der Schichten im Fenster, nach Tag ihrer Erstellung. Typ- und Kategoriecodes der Version sind nicht entschlüsselt (SAX-34) und bleiben weg.</p>
    </app-card>
  `,
})
export class RiverView {
  protected readonly store = inject(Ac8Store);
  protected readonly theme = inject(ThemeService);

  protected readonly sub = computed(() => {
    const rows = this.store.river.rows();
    const n = rows.reduce((a, r) => a + r.versionen, 0);
    const days = new Set(rows.map((r) => r.tag)).size;
    return `${num(n)} Versionen an ${num(days)} Tagen${this.store.brush() ? ', nur Auswahl der Vorlaufzeit' : ''}`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const t = this.theme.tokens();
    const c = ac8Colors(t);
    const rows = this.store.river.rows();
    const art = this.store.riverSerie() === 'art';
    const present = new Set(rows.map((r) => r.kategorie ?? 'keine Rückmeldung'));
    const cats = (art ? ['Erstversion', 'Änderung'] : RM_ORDER).filter((k) => present.has(k));
    const color = (k: string) => (art ? (k === 'Erstversion' ? c.erst : c.aenderung) : (c.rueckmeldung[k] ?? t.neutral));
    const given = [...new Set(rows.map((r) => r.tag.slice(0, 10)))].sort();
    // a continuous day axis: themeRiver interpolates between the dates it gets, so days without versions get 0
    const days: string[] = [];
    if (given.length) for (let d = dayMs(given[0])!; d <= dayMs(given[given.length - 1])!; d = addDays(d, 1)) days.push(isoDay(d));
    const val = new Map(rows.map((r) => [`${r.tag.slice(0, 10)}|${r.kategorie ?? 'keine Rückmeldung'}`, r.versionen]));
    const data = cats.flatMap((k) => days.map((d) => [d, val.get(`${d}|${k}`) ?? 0, k]));
    return {
      aria: ariaDecal(), // thin streams: a pattern would hide them; legend + tooltip name each
      color: cats.map(color),
      legend: { top: 0, left: 0, data: cats, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: t.ink2 } },
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'line', lineStyle: { color: t.axis } },
        formatter: (ps: { value: [string, number, string]; color: string }[]) =>
          ttHead(dateShort(dayMs(ps[0].value[0])!)) + ps.filter((p) => p.value[1] > 0).map((p) => ttRow(p.color, p.value[2], num(p.value[1]))).join(''),
      },
      singleAxis: { type: 'time', top: 36, bottom: 26, left: 8, right: 8, axisLabel: { color: t.muted }, axisPointer: { animation: true, label: { show: false } }, splitLine: { show: false } },
      series: [{ type: 'themeRiver', emphasis: { focus: 'self' }, label: { show: false }, data }],
    };
  });
}
