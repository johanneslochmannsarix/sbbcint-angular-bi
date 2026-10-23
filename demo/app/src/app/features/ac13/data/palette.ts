import { Mode, TOKENS } from '../../../core/tokens';

/**
 * AC-13 semantic colours, built from the shell's validated categorical slots (core/tokens.ts) - red is never a
 * series. Calendar categories: Tour = slot 0 (blue), Ruhetag = slot 2 (green), Urlaub = slot 3 (amber); validated
 * as a trio with scripts/validate_palette.js 2026-10-21 (light: all pass, contrast WARN for green / amber on white
 * -> relief: legend with counts, the person table, a texture decal on Urlaub; dark: all pass). «übrige + ohne
 * Eintrag» is the neutral grey, never a hue: it is the absence of a painted state (Q1 ruling a).
 * Übernachtung = slot 1 (orange) as a marker / edge colour; Arbeitszeit = the sequential blue.
 */
export interface Ac13Colors {
  tour: string;
  ruhe: string;
  urlaub: string;
  rest: string;
  offen: string;
  ue: string;
  verkauft: string;
  schulung: string;
  az: string;
  anger: string;
  seq: readonly string[];
}

export function ac13Colors(mode: Mode): Ac13Colors {
  const t = TOKENS[mode];
  return {
    tour: t.series[0],
    ruhe: t.series[2],
    urlaub: t.series[3],
    rest: t.neutral,
    offen: t.series[6],
    ue: t.series[1],
    verkauft: t.series[4],
    schulung: t.series[6],
    az: t.series[0],
    anger: t.series[6],
    seq: t.seq,
  };
}

/** Texture for Urlaub cells (secondary encoding for the light-mode contrast WARN). */
export function urlaubDecal(color: string): Record<string, unknown> {
  return { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: Math.PI / 4, color };
}
