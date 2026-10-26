/**
 * Chart tokens. Categorical slots are the dataviz reference palette (validated adjacent pairs against
 * #ffffff light / #161c21 dark, metrics app + AC-2). Red (critical) is never a data series: it is reserved
 * for failures (report design system rule). A feature may add its own semantic tokens on top (AC-2 status
 * hues live in features/ac2/data/tokens.ts) but builds them from these slots.
 */
export type Mode = 'light' | 'dark';

export interface ChartTokens {
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  /** "nothing / waiting / not applicable": never a series hue */
  neutral: string;
  /** categorical slots, in a fixed order: colour follows the category, never its rank */
  series: readonly string[];
  /** single-hue sequential ramp (blue), light -> dark */
  seq: readonly string[];
  tooltipBg: string;
  tooltipBorder: string;
  critical: string;
  serious: string;
}

export const TOKENS: Record<Mode, ChartTokens> = {
  light: {
    surface: '#ffffff',
    ink: '#15212b',
    ink2: '#4a5866',
    muted: '#7a8590',
    grid: '#e4e9ed',
    axis: '#c3ccd3',
    neutral: '#b4bdc5',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'],
    seq: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    tooltipBg: '#ffffff',
    tooltipBorder: '#d3dae0',
    critical: '#d03b3b',
    serious: '#ec835a',
  },
  dark: {
    surface: '#161c21',
    ink: '#e4e9ed',
    ink2: '#a9b5bf',
    muted: '#7d8893',
    grid: '#252e35',
    axis: '#3a454e',
    neutral: '#59656f',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
    seq: ['#13314f', '#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6'],
    tooltipBg: '#1d252b',
    tooltipBorder: '#34404a',
    critical: '#d03b3b',
    serious: '#ec835a',
  },
};

/**
 * The SBB style variant (core/style.ts, `?style=sbb`): the same slots built from the SBB lean colour spec
 * (typography.css of @sbb-esta/angular 22.2.0: sky #0079c7, orange #f27e00, green #00973b, violet #6f2282,
 * peach #fcbb00, night #143a85), lightness-stepped in OKLCH into the dataviz band and validated with
 * validate_palette.js on 2026-10-24: light vs #ffffff and dark vs #212121 (charcoal, the card surface), all
 * checks pass (worst adjacent CVD dE 12.7 light / 8.8 dark). Slot 6 is a second green, as in TOKENS. SBB red is
 * never a series (critical keeps the shell's failure red); the sequential ramp is SBB sky.
 */
export const SBB_TOKENS: Record<Mode, ChartTokens> = {
  light: {
    surface: '#ffffff',
    ink: '#000000',
    ink2: '#444444',
    muted: '#767676',
    grid: '#e5e5e5',
    axis: '#bdbdbd',
    neutral: '#b7b7b7',
    series: ['#0079c7', '#da720a', '#0a6728', '#8c40a0', '#ba8901', '#426cbb', '#21a447'],
    seq: ['#d1e8fe', '#a1d0fc', '#62b4fe', '#3295e5', '#0676c1', '#015893', '#023f6c'],
    tooltipBg: '#ffffff',
    tooltipBorder: '#d2d2d2',
    critical: '#d03b3b',
    serious: '#ec835a',
  },
  dark: {
    surface: '#212121',
    ink: '#ffffff',
    ink2: '#dcdcdc',
    muted: '#a8a8a8',
    grid: '#333333',
    axis: '#5a5a5a',
    neutral: '#686868',
    series: ['#1682d0', '#af5b08', '#2baa4e', '#b86bcd', '#a07503', '#618de0', '#088233'],
    seq: ['#003053', '#024574', '#065b96', '#0676c1', '#3295e5', '#62b4fe', '#a7d3fd'],
    tooltipBg: '#2a2a2a',
    tooltipBorder: '#444444',
    critical: '#d03b3b',
    serious: '#ec835a',
  },
};

export type StyleVariant = 'demo' | 'sbb';

const DEMO_FONTS = {
  ui: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  num: 'Bahnschrift, "DIN Alternate", "Segoe UI", system-ui, sans-serif',
};
const SBB_FALLBACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * The sbb variant's chart font, read from the lazy stylesheet (styles-sbb.css `--ui-chart-font`, = SBB's own font
 * stack variable) instead of naming the font here: the synthetic package's leak gate reads the JS bundles word by
 * word, and a font's family name can equal a real person's first name. Before sbb.css has loaded: SBB's fallbacks.
 */
function sbbFont(): string {
  try {
    // one line: the stylesheet's value keeps its line breaks, a canvas font string must not
    const v = getComputedStyle(document.documentElement).getPropertyValue('--ui-chart-font').replace(/\s+/g, ' ').trim();
    return v || SBB_FALLBACK;
  } catch {
    return SBB_FALLBACK;
  }
}

/**
 * Chart fonts. Live ES module bindings (`export let`): StyleService calls useFonts() before it flips the variant
 * signal, so every chart option recomputed for the new tokens (theme.tokens() changes with the variant) reads the
 * new stack - the features keep importing FONT_UI / FONT_NUM unchanged.
 */
export let FONT_UI = DEMO_FONTS.ui;
export let FONT_NUM = DEMO_FONTS.num;
export function useFonts(variant: StyleVariant): void {
  FONT_UI = variant === 'sbb' ? sbbFont() : DEMO_FONTS.ui;
  FONT_NUM = variant === 'sbb' ? FONT_UI : DEMO_FONTS.num;
}

export function chartTokens(variant: StyleVariant, mode: Mode): ChartTokens {
  return (variant === 'sbb' ? SBB_TOKENS : TOKENS)[mode];
}

/**
 * echarts theme names. demo-*: registered by core/echarts-setup.ts at load. sbb-<mode>-<rev>: registered there on
 * first use with the font of that moment; `rev` (StyleService.fontRev) changes once sbb.css has loaded, so every
 * chart is re-created with the SBB font.
 */
export const ECHARTS_THEMES: Record<StyleVariant, Record<Mode, string>> = {
  demo: { light: 'demo-light', dark: 'demo-dark' },
  sbb: { light: 'sbb-light', dark: 'sbb-dark' },
};
export function echartsTheme(variant: StyleVariant, mode: Mode, rev: number): string {
  return variant === 'sbb' ? `${ECHARTS_THEMES.sbb[mode]}-${rev}` : ECHARTS_THEMES.demo[mode];
}
/** the demo variant's names (unchanged export) */
export const ECHARTS_THEME: Record<Mode, string> = ECHARTS_THEMES.demo;
