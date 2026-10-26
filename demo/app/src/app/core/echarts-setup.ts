/**
 * Lazily imported by provideEchartsCore({ echarts: () => import(...) }), so echarts stays out of the
 * initial bundle. Tree-shaken registration per the ngx-echarts v22 README (echarts/core + echarts.use).
 *
 * Registers every chart type / component / feature the three showcase handovers name, checked against the
 * echarts 6.1.0 exports (node_modules/echarts/types/dist/{charts,components,features}.d.ts):
 *   AC-2  heatmap + visualMap, calendar, custom, treemap / sunburst, sankey, dataZoom, brush, bar, line
 *   AC-1  calendar + heatmap, custom (Gantt), geo + registerMap, effectScatter, lines (effect / trail),
 *         timeline, connect
 *   AC-8  polar + bar, universalTransition, sankey, themeRiver (singleAxis), large / progressive scatter,
 *         custom renderItem, geo / lines / effect, graph (force), calendar, timeline autoplay, aria + decal,
 *         markArea, line sparklines, connect
 *   D2    metrics pages: boxplot + dataset / transform, scatter, markLine
 * Anything else is a core request (demo/core-requests-<ac>.md); echarts-gl is not installed.
 */
import * as echarts from 'echarts/core';
import {
  BarChart,
  BoxplotChart,
  CustomChart,
  EffectScatterChart,
  GraphChart,
  HeatmapChart,
  LineChart,
  LinesChart,
  MapChart,
  SankeyChart,
  ScatterChart,
  SunburstChart,
  ThemeRiverChart,
  TreemapChart,
} from 'echarts/charts';
import {
  AriaComponent,
  AxisPointerComponent,
  BrushComponent,
  CalendarComponent,
  DataZoomComponent,
  DatasetComponent,
  GeoComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  PolarComponent,
  SingleAxisComponent,
  TimelineComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent,
} from 'echarts/components';
import { LabelLayout, UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
import { ChartTokens, ECHARTS_THEMES, FONT_UI, SBB_TOKENS, TOKENS } from './tokens';

echarts.use([
  BarChart,
  BoxplotChart, // also registers the built-in 'boxplot' dataset transform
  CustomChart,
  EffectScatterChart,
  GraphChart,
  HeatmapChart,
  LineChart,
  LinesChart,
  MapChart,
  SankeyChart,
  ScatterChart,
  SunburstChart,
  ThemeRiverChart,
  TreemapChart,
  AriaComponent,
  AxisPointerComponent,
  BrushComponent,
  CalendarComponent,
  DataZoomComponent, // inside + slider
  DatasetComponent,
  GeoComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent, // plain + scroll
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  PolarComponent,
  SingleAxisComponent,
  TimelineComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent, // continuous + piecewise
  LabelLayout,
  UniversalTransition,
  CanvasRenderer,
]);

function theme(t: ChartTokens, font: string, filler: string): object {
  const axis = {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontFamily: font },
    splitLine: { lineStyle: { color: t.grid, type: 'solid', width: 1 } },
    nameTextStyle: { color: t.muted },
  };
  return {
    color: t.series,
    backgroundColor: 'transparent',
    textStyle: { color: t.ink2, fontFamily: font },
    title: { textStyle: { color: t.ink }, subtextStyle: { color: t.muted } },
    legend: { textStyle: { color: t.ink2 }, inactiveColor: t.axis, pageTextStyle: { color: t.muted } },
    tooltip: {
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: t.ink, fontFamily: font, fontSize: 12 },
      extraCssText: 'box-shadow:none;border-radius:4px;',
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: axis,
    logAxis: axis,
    timeAxis: { ...axis, splitLine: { show: false } },
    angleAxis: axis,
    radiusAxis: axis,
    singleAxis: axis,
    dataZoom: {
      textStyle: { color: t.muted },
      borderColor: t.axis,
      fillerColor: filler,
      handleStyle: { color: t.surface, borderColor: t.ink2 },
      moveHandleStyle: { color: t.axis },
      dataBackground: { lineStyle: { color: t.axis }, areaStyle: { color: t.grid } },
    },
    visualMap: { textStyle: { color: t.ink2 } },
    toolbox: { iconStyle: { borderColor: t.ink2 } },
    // transparent cells: a series on the calendar (custom, heatmap) is never hidden behind them at the default z
    // (core request ac1 #6, D2 2026-10-21); the card surface shows through
    calendar: {
      itemStyle: { color: 'transparent', borderColor: t.grid },
      splitLine: { lineStyle: { color: t.axis } },
      dayLabel: { color: t.muted },
      monthLabel: { color: t.ink2 },
      yearLabel: { color: t.muted },
    },
    timeline: {
      lineStyle: { color: t.axis },
      itemStyle: { color: t.axis },
      label: { color: t.muted },
      controlStyle: { color: t.ink2, borderColor: t.ink2 },
      checkpointStyle: { color: t.series[0], borderColor: t.surface },
    },
    geo: {
      itemStyle: { areaColor: t.grid, borderColor: t.axis },
      emphasis: { itemStyle: { areaColor: t.axis }, label: { color: t.ink } },
      label: { color: t.muted },
    },
    graph: { lineStyle: { color: t.axis }, label: { color: t.ink2 } },
  };
}
const DEMO_FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
echarts.registerTheme(ECHARTS_THEMES.demo.light, theme(TOKENS.light, DEMO_FONT, 'rgba(42,120,214,0.12)'));
echarts.registerTheme(ECHARTS_THEMES.demo.dark, theme(TOKENS.dark, DEMO_FONT, 'rgba(42,120,214,0.12)'));

/**
 * The SBB style variant (core/style.ts, tokens.ts echartsTheme): same theme shape, SBB tokens, registered on first
 * use as «sbb-<mode>-<rev>» with the chart font of that moment (FONT_UI, read from sbb.css once it has loaded).
 */
const sbbThemes = new Set<string>();
function ensureSbbTheme(name: unknown): void {
  if (typeof name !== 'string' || sbbThemes.has(name)) return;
  const m = /^sbb-(light|dark)-\d+$/.exec(name);
  if (!m) return;
  const dark = m[1] === 'dark';
  echarts.registerTheme(name, theme(dark ? SBB_TOKENS.dark : SBB_TOKENS.light, FONT_UI, dark ? 'rgba(22,130,208,0.16)' : 'rgba(0,121,199,0.12)'));
  sbbThemes.add(name);
}

type InitArgs = Parameters<typeof echarts.init>;
type Pending = { theme: InitArgs[1]; opts: InitArgs[2]; chart: Promise<echarts.ECharts> };
const pending = new WeakMap<HTMLElement, Pending>();

/**
 * echarts.init as ngx-echarts 22 calls it: `load().then(({ init }) => init(dom, theme, opts))`, so a returned
 * Promise is awaited (node_modules/ngx-echarts/fesm2022/ngx-echarts.mjs createChart). Removes three warnings
 * every showcase logged (core-requests-ac1.md #4) and one error (4., see create); echarts behaviour is
 * unchanged otherwise.
 * 1. «There is a chart instance already initialized on the dom»: ngx-echarts creates a chart asynchronously, so
 *    [options] changing again before that settles calls init twice on one element. echarts then warns and
 *    returns the existing instance (lib/core/echarts.js init); this returns it without the warning.
 * 2. «Can't get DOM width or height»: a chart whose element is still 0 x 0 (an empty Gantt, an idle panel) is
 *    created once the element has a size. Calls for the same element meanwhile share one creation, with the
 *    latest theme (a theme switch while waiting must not create the chart in the old theme).
 * 3. «Instance ec_… has been disposed»: after a theme switch ngx-echarts' lazy-event teardown checks the NEW chart
 *    but calls off() on the OLD, disposed one (createLazyEvent). off() on a disposed chart is a silent no-op here.
 */
export function init(dom: HTMLElement, theme?: InitArgs[1], opts?: InitArgs[2]): echarts.ECharts | Promise<echarts.ECharts> {
  ensureSbbTheme(theme);
  const existing = echarts.getInstanceByDom(dom);
  if (existing) return existing;
  const waiting = pending.get(dom);
  if (waiting) {
    waiting.theme = theme;
    waiting.opts = opts;
    return waiting.chart;
  }
  if (dom.clientWidth > 0 && dom.clientHeight > 0) return create(dom, theme, opts);
  const entry: Pending = { theme, opts, chart: null! };
  entry.chart = new Promise((resolve) => {
    const ro = new ResizeObserver(() => {
      // a removed element reports 0 x 0 and is dropped; ngx-echarts has destroyed its directive by then
      if (!dom.isConnected) {
        ro.disconnect();
        pending.delete(dom);
        return;
      }
      if (dom.clientWidth === 0 || dom.clientHeight === 0) return;
      ro.disconnect();
      pending.delete(dom);
      resolve(echarts.getInstanceByDom(dom) ?? create(dom, entry.theme, entry.opts));
    });
    ro.observe(dom);
  });
  pending.set(dom, entry);
  return entry.chart;
}

function create(dom: HTMLElement, theme: InitArgs[1], opts: InitArgs[2]): echarts.ECharts {
  const chart = echarts.init(dom, theme, opts);
  const off = chart.off as (...args: unknown[]) => unknown;
  (chart as unknown as { off: typeof off }).off = function (this: echarts.ECharts, ...args: unknown[]) {
    return this.isDisposed() ? undefined : off.apply(this, args);
  };
  // 4. (D2 2026-10-21) setOption(null / undefined) is a no-op. Views bind `[options]="options()!"` where options()
  //    is null until their data is there; when ngx-echarts creates the chart in that moment (fast route / tenant
  //    switches, e.g. the story mode) echarts' assert «option is null/undefined» threw inside setOption and left
  //    the instance «in main process», so every later setOption / resize was refused.
  const setOption = chart.setOption as (...args: unknown[]) => unknown;
  (chart as unknown as { setOption: typeof setOption }).setOption = function (this: echarts.ECharts, option: unknown, ...rest: unknown[]) {
    return option == null ? undefined : setOption.call(this, option, ...rest);
  };
  return chart;
}

// Dev builds only: the style-variant parity check (demo/probes/style/parity.js) reads chart options through this;
// it compares hashes, never prints values. Production builds (ngDevMode false) do not expose it.
declare const ngDevMode: unknown;
if (typeof ngDevMode !== 'undefined' && ngDevMode) {
  (globalThis as Record<string, unknown>)['__demoEcharts'] = { getInstanceByDom: echarts.getInstanceByDom };
}

export const connect = echarts.connect;
export const disconnect = echarts.disconnect;
/** For offline GeoJSON basemaps (AC-1 / AC-8, after Johannes' download OK): registerMap(name, geoJson). */
export const registerMap = echarts.registerMap;
export const getMap = echarts.getMap;
