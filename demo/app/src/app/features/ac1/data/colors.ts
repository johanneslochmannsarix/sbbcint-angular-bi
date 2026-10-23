/**
 * AC-1 colour keys, built from the shell's validated categorical slots (core/tokens.ts) in a FIXED order:
 * colour follows the activity group, never its rank or the filter. Red is never a series (shell rule).
 *
 * Activity groups (dim_workeractivity[activity_group], live 2026-10-21: 9 groups + none). Seven slots, so
 * «Sonstige (zu klären)» and «Zeitausgleich» fold into «Weitere»; «Pause» is the neutral (a "nothing"
 * state), and a tour without an activity is an outline - for Auszubildende that is every tour, because the
 * export carries no activity for them (0 of 3 587 PROD rows).
 *
 * Trainee views (trainee calendar, cohort grid) colour by tour instead: the 6 most frequent tours of the
 * loaded period get slots 0-5 in frequency order, the rest «Weitere Touren» (slot 6). That order is fixed for
 * the period on screen.
 */
import { ChartTokens } from '../../../core/tokens';

export const NONE = '∅';
export const GROUP_ORDER = [
  'Einsatz Ausbilder',
  'Ausbildung (Lernende)',
  'Operativer Einsatz',
  'Reise / Gastfahrt',
  'Bereitschaft / Dispo',
  'Weitere',
  'Overhead / Admin',
  'Pause',
  NONE,
] as const;
const SLOT: Record<string, number> = {
  'Einsatz Ausbilder': 0,
  'Ausbildung (Lernende)': 1,
  'Operativer Einsatz': 2,
  'Reise / Gastfahrt': 3,
  'Bereitschaft / Dispo': 4,
  Weitere: 5,
  'Overhead / Admin': 6,
};
const FOLD: Record<string, string> = { 'Sonstige (zu klären)': 'Weitere', Zeitausgleich: 'Weitere' };

export function groupKey(activityGroup: string | null | undefined): string {
  if (!activityGroup) return NONE;
  if (FOLD[activityGroup]) return FOLD[activityGroup];
  return SLOT[activityGroup] != null || activityGroup === 'Pause' ? activityGroup : 'Weitere';
}

export function groupLabel(key: string): string {
  if (key === NONE) return 'ohne Tätigkeit';
  if (key === 'Weitere') return 'Weitere (Sonstige, Zeitausgleich)';
  return key;
}

export interface Paint {
  fill: string;
  stroke: string | null;
}

export function groupPaint(key: string, t: ChartTokens): Paint {
  if (key === NONE) return { fill: t.surface, stroke: t.muted };
  if (key === 'Pause') return { fill: t.neutral, stroke: null };
  return { fill: t.series[SLOT[key] ?? 5], stroke: null };
}

/** Text colour on a filled mark: dark ink on light fills, white on dark ones (WCAG relative luminance). */
export function inkOn(fill: string, t: ChartTokens): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return t.ink;
  const lin = (i: number) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return l > 0.28 ? '#15212b' : '#ffffff';
}

/** Tour palette for trainee views: tours by frequency -> slot; everything past the 6th shares slot 6. */
export const OTHER_TOURS = 'Weitere Touren';
export function tourPalette(counts: Map<string, number>): Map<string, number> {
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
  return new Map(top.map(([k], i) => [k, i]));
}
export function tourKeyOf(tour: string | null | undefined, palette: Map<string, number>): string {
  const k = tour ?? '(ohne Tourbezeichnung)';
  return palette.has(k) ? k : OTHER_TOURS;
}
export function tourPaint(key: string, palette: Map<string, number>, t: ChartTokens): Paint {
  return { fill: t.series[palette.get(key) ?? 6], stroke: null };
}
