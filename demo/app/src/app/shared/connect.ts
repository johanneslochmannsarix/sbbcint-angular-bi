import { DestroyRef, Directive, effect, inject, input } from '@angular/core';
import type { ECharts } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';

/**
 * echarts.connect helper. Charts with the same group id share tooltip / axisPointer / dataZoom / brush /
 * legend actions (https://echarts.apache.org/en/api.html#echarts.connect):
 *
 *   <div echarts [options]="..." chartGroup="ac8-story"></div>
 *
 * Uses the same lazily loaded echarts instance as ngx-echarts (core/echarts-setup), so it adds nothing
 * to the initial bundle. Group ids are per feature: prefix them with the showcase ("ac1-day").
 */
@Directive({ selector: '[echarts][chartGroup]' })
export class ChartGroup {
  readonly chartGroup = input.required<string>();

  constructor() {
    const ec = inject(NgxEchartsDirective);
    let chart: ECharts | null = null;
    const apply = () => {
      if (!chart || chart.isDisposed()) return;
      const g = this.chartGroup();
      chart.group = g;
      void connectGroup(g);
    };
    const sub = ec.chartInit.subscribe((c) => {
      chart = c;
      apply();
    });
    effect(() => {
      this.chartGroup();
      apply();
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }
}

/** Connect every chart whose `group` is `id` (charts may join later: connect is idempotent). */
export async function connectGroup(id: string): Promise<void> {
  const e = await import('../core/echarts-setup');
  e.connect(id);
}
