import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import type { ECharts } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';

/**
 * ngx-echarts ignores the first ResizeObserver callback ("no resize actually happened"). A chart that
 * was initialised while its element was 0 x 0 (hidden pane, layout not settled) therefore never gets
 * its real size. This sits on the same host and resizes on every real size change.
 */
@Directive({ selector: '[echarts]' })
export class ChartResize {
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const ec = inject(NgxEchartsDirective);
    let chart: ECharts | null = null;
    let last = '';
    const sync = () => {
      const key = `${host.clientWidth}x${host.clientHeight}`;
      if (chart && !chart.isDisposed() && host.clientWidth > 0 && host.clientHeight > 0 && key !== last) {
        last = key;
        chart.resize();
      }
    };
    const sub = ec.chartInit.subscribe((c) => {
      chart = c;
      last = '';
      requestAnimationFrame(sync);
    });
    const ro = new ResizeObserver(() => requestAnimationFrame(sync));
    ro.observe(host);
    inject(DestroyRef).onDestroy(() => {
      ro.disconnect();
      sub.unsubscribe();
    });
  }
}
