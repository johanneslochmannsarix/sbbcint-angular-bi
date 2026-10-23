import { DestroyRef, Directive, effect, inject, input, signal } from '@angular/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';

/**
 * «Apply options with replaceMerge» (core request ac8 #3, D2 2026-10-21). ngx-echarts applies [options] with
 * setOption(opt, true) (notMerge), which breaks a universalTransition morph between coordinate systems
 * (polar <-> cartesian): the morph needs merge semantics with `replaceMerge: ['series']`, series ids that
 * differ per shape, and `universalTransition.seriesKey` pairing them (with the same id echarts kept the polar
 * sectors on the cartesian grid). Used by AC-8's Schichtuhr and the shared story mode.
 *
 *   <div echarts [options]="{}" [mergeOptions]="options()" [theme]="theme.echartsTheme()"></div>
 *
 * Keep [options] an empty object: ngx-echarts still owns init / resize / dispose and the theme switch
 * (core/echarts-setup.ts init). Each new chart instance (theme switch) gets the current options again.
 */
@Directive({ selector: '[echarts][mergeOptions]' })
export class MergeOptions {
  readonly mergeOptions = input<EChartsCoreOption | null>(null);
  /** Components replaced (not merged) on every update; others merge by id / index. */
  readonly replaceMerge = input<string[]>(['series']);
  /** The live chart, for callers that dispatch actions (story mode). */
  readonly chart = signal<ECharts | null>(null);

  constructor() {
    const host = inject(NgxEchartsDirective);
    const sub = host.chartInit.subscribe((c) => this.chart.set(c));
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
    effect(() => {
      const c = this.chart();
      const o = this.mergeOptions();
      if (c && o) applyMerged(c, o, this.replaceMerge());
    });
  }
}

/** The same, imperatively, for code that holds a chart instance. A disposed chart is ignored. */
export function applyMerged(chart: ECharts, option: EChartsCoreOption, replaceMerge: string[] = ['series']): void {
  if (chart.isDisposed()) return;
  chart.setOption(option, { replaceMerge });
}
