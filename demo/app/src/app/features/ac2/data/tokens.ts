/**
 * Chart tokens. Status hues: the first three slots of the dataviz reference palette, validated all-pairs
 * (validate_palette.js --pairs all) against #ffffff (light) and #161c21 (dark): worst CVD dE 9.2 / 9.4,
 * normal-vision 24.0 / 20.9. A fourth hue failed every candidate set, so "expired" is a strong neutral and
 * "dates missing" is a ring (secondary encoding). Red is never a data colour (report design system rule).
 */
export type Mode = 'light' | 'dark';

export type StatusCode = 'VALID_GT_90' | 'VALID_LT_90' | 'NOT_YET_VALID' | 'EXPIRED' | 'DATES_MISSING' | 'MISSING_NEVER';
/** Better status first: when a pair has two rows (RT&S alias rows) the cell shows the earlier one. */
export const STATUS_ORDER: readonly StatusCode[] = ['VALID_GT_90', 'VALID_LT_90', 'NOT_YET_VALID', 'EXPIRED', 'DATES_MISSING', 'MISSING_NEVER'];
export const HELD: readonly StatusCode[] = ['VALID_GT_90', 'VALID_LT_90', 'NOT_YET_VALID', 'EXPIRED', 'DATES_MISSING'];
/** German fallback labels; the model's dim_status_code[label_de] wins when it is loaded. */
export const STATUS_FALLBACK_LABEL: Record<StatusCode, string> = {
  VALID_GT_90: 'Gültig',
  VALID_LT_90: '< 90 Tage gültig',
  NOT_YET_VALID: 'Noch nicht gültig',
  EXPIRED: 'Abgelaufen',
  DATES_MISSING: 'Ohne Datumsangabe',
  MISSING_NEVER: 'Fehlt',
};

export interface ChartTokens {
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  status: Record<StatusCode, string>;
  /** ring colour that marks DATES_MISSING cells */
  ring: string;
  /** single-hue sequential ramp (blue), light -> dark */
  seq: readonly string[];
  /** a person without a name (QDASH-8): neutral, never a series hue */
  noName: string;
}

export const TOKENS: Record<Mode, ChartTokens> = {
  light: {
    surface: '#ffffff',
    ink: '#15212b',
    ink2: '#4a5866',
    muted: '#6f7b86',
    grid: '#e4e9ed',
    axis: '#c3ccd3',
    tooltipBg: '#ffffff',
    tooltipBorder: '#d3dae0',
    status: {
      VALID_GT_90: '#2a78d6',
      VALID_LT_90: '#eb6834',
      NOT_YET_VALID: '#1baf7a',
      EXPIRED: '#3b4752',
      DATES_MISSING: '#e9edf1',
      MISSING_NEVER: '#eef1f4',
    },
    ring: '#7a8590',
    seq: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    noName: '#aab4bd',
  },
  dark: {
    surface: '#161c21',
    ink: '#e4e9ed',
    ink2: '#a9b5bf',
    muted: '#84909a',
    grid: '#252e35',
    axis: '#3a454e',
    tooltipBg: '#1d252b',
    tooltipBorder: '#34404a',
    status: {
      VALID_GT_90: '#3987e5',
      VALID_LT_90: '#d95926',
      NOT_YET_VALID: '#199e70',
      EXPIRED: '#c9d2d9',
      DATES_MISSING: '#222b32',
      MISSING_NEVER: '#1d252b',
    },
    ring: '#8b97a2',
    seq: ['#13314f', '#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6'],
    noName: '#56626c',
  },
};

export const FONT_UI = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
export const FONT_NUM = 'Bahnschrift, "DIN Alternate", "Segoe UI", system-ui, sans-serif';
