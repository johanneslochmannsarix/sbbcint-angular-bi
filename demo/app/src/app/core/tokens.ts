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

export const FONT_UI = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
export const FONT_NUM = 'Bahnschrift, "DIN Alternate", "Segoe UI", system-ui, sans-serif';

/** echarts theme names registered by core/echarts-setup.ts */
export const ECHARTS_THEME: Record<Mode, string> = { light: 'demo-light', dark: 'demo-dark' };
