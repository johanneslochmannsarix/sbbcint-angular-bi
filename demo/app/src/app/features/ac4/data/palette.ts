import { Mode } from '../../../core/tokens';

/**
 * AC-4 semantic colours. The report design system fixes the meaning of each series hue (CHART_COLORS in
 * scripts/pbir_identity.py): Plandauer Stahlblau, Fahren Petrol, Ist Ocker, «nach Akzeptanz neu versendet»
 * Tannengrün; NEUTRAL for «nichts / keine Person»; LINE for «unverändert». Red is never a series (F8).
 *
 * Validated with the dataviz validate_palette.js (2026-10-21), adjacent order plan, fahren, ist, neu:
 *   light (report hexes; Petrol nudged #0E9A94 -> #0A9C8A: the original pair Stahlblau/Petrol sat at
 *     ΔE 14.9, under the normal-vision floor of 15) - all five checks PASS
 *   dark (own steps from the same hues, against #161c21) - all checks PASS
 */
export interface Ac4Colors {
  plan: string;
  fahren: string;
  ist: string;
  neu: string;
  neutral: string;
  line: string;
  /** single-hue Stahlblau ramp, light -> dark (sequential: magnitude only) */
  seq: readonly string[];
  /** Person Zuordnung (generator ZUORDNUNG_COLORS) */
  zuordnung: Record<string, string>;
  /** fico_kommunikation Verlauf (generator VERLAUF_COLORS) */
  verlauf: Record<string, string>;
}

const BASE: Record<Mode, Pick<Ac4Colors, 'plan' | 'fahren' | 'ist' | 'neu' | 'neutral' | 'line' | 'seq'>> = {
  light: {
    plan: '#186A99', fahren: '#0A9C8A', ist: '#B5771C', neu: '#17754E', neutral: '#C6C2BE', line: '#E5E0DA',
    seq: ['#e3eef5', '#bcd5e6', '#8db7d3', '#5b96bd', '#2f77a6', '#186A99', '#0f4b6e'],
  },
  dark: {
    plan: '#5B8FE0', fahren: '#1FA38A', ist: '#B87A22', neu: '#2F9A7A', neutral: '#5F646A', line: '#353C42',
    seq: ['#17293a', '#1d3c58', '#25537c', '#2f6aa2', '#4583c6', '#5B8FE0', '#9dbdf0'],
  },
};

export function ac4Colors(mode: Mode): Ac4Colors {
  const b = BASE[mode];
  return {
    ...b,
    zuordnung: { eingeteilt: b.plan, 'Person nicht im Export': b.ist, 'keine Person eingeteilt': b.neutral },
    verlauf: {
      'unverändert': b.line,
      'vor Akzeptanz geändert': b.plan,
      'nach Akzeptanz geändert, nicht versendet': b.ist,
      'nach Akzeptanz geändert, neu versendet': b.neu,
      'nie kommuniziert': b.neutral,
    },
  };
}

/** Fahren (ja / nein / leer) -> colour, as the report's «Farbe = Fahren». */
export function fahrenColor(c: Ac4Colors, f: string | null | undefined): string {
  return f === 'ja' ? c.fahren : f === 'nein' ? c.plan : c.neutral;
}

/** Hatch for «derived», «unvollständiger Monat» and «ohne Ist» - shape carries the state, not colour alone. */
export const HATCH = { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: 'rgba(255,255,255,0.55)' } as const;
export const HATCH_DARK = { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: 'rgba(0,0,0,0.35)' } as const;
