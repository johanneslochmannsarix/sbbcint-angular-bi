import { Mode } from '../../../core/tokens';

/**
 * AC-9 semantic colours, from the report design system (scripts/pbir_identity.py CHART_COLORS, the theme family
 * of «Qualifikationen RT&S»). Red is never a series.
 *   Geschäftsart: AÜ Stahlblau (slot 1), DL Ocker (slot 2) - fixed by entity, as in the report.
 *   Zeitart inside the billable hours: Einsatz Tannengrün (3), AZU Flieder (4), Fahrten Petrol (5); Pause = the
 *   neutral (deducted, never billed). The report paints Arbeit/AZU with slots 1/2; here they would collide with
 *   AÜ/DL on the same page, so the Zeitarten take the next three slots.
 *   Totals are ink: an invoice sums in black. PLAN is an outline in muted ink, never a fill.
 * Validated with the dataviz validate_palette.js (2026-10-21), adjacent order as stacked (Einsatz, AZU, Fahrt) and
 * AÜ/DL: light (report hexes, surface #fcfcfb) all checks PASS; dark (own steps, surface #161c21) all checks PASS.
 * Einsatz and Fahrt are never adjacent (ΔE 13.2 light).
 */
export interface Ac9Colors {
  aue: string;
  dl: string;
  einsatz: string;
  azu: string;
  fahrt: string;
  pause: string;
  total: string;
  plan: string;
  /** AÜ / DL light steps for the sunburst's outer rings (same hue, lighter) */
  aueSoft: string;
  dlSoft: string;
}

const C: Record<Mode, Ac9Colors> = {
  light: {
    aue: '#186A99', dl: '#B5771C', einsatz: '#17754E', azu: '#946FD0', fahrt: '#0E9A94', pause: '#C6C2BE',
    total: '#15212b', plan: '#7a8590', aueSoft: '#5b96bd', dlSoft: '#d3a45e',
  },
  dark: {
    aue: '#5B8FE0', dl: '#B87A22', einsatz: '#2F9A6A', azu: '#9272D0', fahrt: '#1F9FA8', pause: '#5F646A',
    total: '#e4e9ed', plan: '#84909a', aueSoft: '#3e6aa8', dlSoft: '#8a5e1c',
  },
};

/** Canvas text cannot read CSS variables: the figure face (same as --ac9-num) for chart labels. */
export const NUM_FONT = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

export function ac9Colors(mode: Mode): Ac9Colors {
  return C[mode];
}

export function gaColor(c: Ac9Colors, ga: string | null | undefined): string {
  return ga === 'AÜ' ? c.aue : ga === 'DL' ? c.dl : c.total;
}

export function zeitartColor(c: Ac9Colors, z: string | null | undefined): string {
  if (z === 'Pause') return c.pause;
  if (z === 'AZU') return c.azu;
  if (z === 'Fahrt') return c.fahrt;
  if (z === 'Arbeit') return c.einsatz;
  return 'transparent';
}

/** Hatch for «abgezogen» (Pause) and for the running month: the shape carries the state, not colour alone. */
export function hatch(mode: Mode): Record<string, unknown> {
  return { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: mode === 'dark' ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.6)' };
}
