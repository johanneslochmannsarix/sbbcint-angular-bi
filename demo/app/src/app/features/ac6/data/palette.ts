import { Mode } from '../../../core/tokens';

/**
 * AC-6 semantic colours. The FiCo report's page «Planung (JUP)» fixes two of them (scripts/build_report_fico.py:
 * Dauer = CHART_1 Stahlblau, davon Fahren = CHART_5 Petrol); the others come from CHART_COLORS
 * (scripts/pbir_identity.py). Red is never a series.
 *
 *   jup     Stahlblau  JUP plan hours (Dauer Tourelemente (Planung))         - as the report's Planung page
 *   fahren  Petrol     Fahren = ja (SaxMS main-driving flag of the activity) - as the report
 *   dispo   Ocker      the disposition's planned hours in view 5             - the other side of the comparison
 *   more / less        Himmelblau / Bronze: version B plans more / less than A (diverging, neutral midpoint)
 *   kosten             Zugfahrt Petrol · Produkt Ocker · Kostenstelle Indigo (the three large codes, one hue each);
 *                      Auftrag and Sonstige (small, < 3 % of any version) share a mid grey, Auftrag hatched;
 *                      Keiner light neutral. Stack order = Zugfahrt, Produkt, Kostenstelle, Auftrag, Sonstige, Keiner
 *
 * Validated with dataviz validate_palette.js on 2026-10-21 (adjacent pairs in the order they sit on screen):
 *   jup / fahren / dispo  = AC-4's plan / fahren / ist set, validated by AC-4 (Petrol nudged #0E9A94 -> #0A9C8A)
 *   kosten light #0A9C8A,#B5771C,#445AB5 and dark #1FA38A,#B87A22,#7C8EE0 - all checks PASS with --pairs all
 *     (codes come and go per version, so any two can meet). Five hues (+ Oliv Auftrag, Flieder Sonstige) passed
 *     adjacent-only but FAILED all-pairs (Oliv/Ocker protan ΔE 0.6, Flieder/Indigo dark normal ΔE 6.1): cut to three
 *     hues + grey + hatch, as the dataviz rule says (cut series rather than stretch the palette).
 *   more/less light #348AD9,#825B00 (ΔE 27.5) and dark #4A8ADB,#B07A1A (ΔE 26.2) - all PASS
 * Rejected on the way: Violett for the JUP next to Stahlblau (deutan ΔE 2.8, normal 13.0 - FAIL), Tannengrün /
 * Bronze as the diverging pair (normal ΔE 13.5 - FAIL).
 */
export interface Ac6Colors {
  jup: string;
  fahren: string;
  dispo: string;
  neutral: string;
  line: string;
  more: string;
  less: string;
  /** single-hue Stahlblau ramp, light -> dark (sequential: magnitude only) */
  seq: readonly string[];
  /** Kostenallokation code -> colour */
  kosten: Record<number, string>;
}

const BASE: Record<Mode, Ac6Colors> = {
  light: {
    jup: '#186A99', fahren: '#0A9C8A', dispo: '#B5771C', neutral: '#C6C2BE', line: '#E5E0DA',
    more: '#348AD9', less: '#825B00',
    seq: ['#e3eef5', '#bcd5e6', '#8db7d3', '#5b96bd', '#2f77a6', '#186A99', '#0f4b6e'],
    kosten: { 5: '#0A9C8A', 2: '#B5771C', 3: '#445AB5', 1: '#8C8781', 4: '#8C8781', 0: '#DDD9D4' },
  },
  dark: {
    jup: '#5B8FE0', fahren: '#1FA38A', dispo: '#B87A22', neutral: '#5F646A', line: '#353C42',
    more: '#4A8ADB', less: '#B07A1A',
    seq: ['#17293a', '#1d3c58', '#25537c', '#2f6aa2', '#4583c6', '#5B8FE0', '#9dbdf0'],
    kosten: { 5: '#1FA38A', 2: '#B87A22', 3: '#7C8EE0', 1: '#7D838A', 4: '#7D838A', 0: '#41474D' },
  },
};

export function ac6Colors(mode: Mode): Ac6Colors {
  return BASE[mode];
}

/** Stack order of the cost-allocation codes (largest, most specific first; «Keiner» last, in neutral). */
export const KOSTEN_ORDER = [5, 2, 3, 1, 4, 0] as const;

/** Fahren (ja / nein / leer) -> colour, as the report's «Farbe = Fahren». */
export function fahrenColor(c: Ac6Colors, f: string | null | undefined): string {
  return f === 'ja' ? c.fahren : f === 'nein' ? c.jup : c.neutral;
}

/** Hatch: a state carried by shape, not colour alone (no counterpart / undecoded). */
export const HATCH = { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: 'rgba(255,255,255,0.55)' } as const;
export const HATCH_DARK = { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: 'rgba(0,0,0,0.4)' } as const;
