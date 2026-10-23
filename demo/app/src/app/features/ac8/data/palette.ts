import { ChartTokens } from '../../../core/tokens';

/**
 * AC-8 semantic colours, built from the shell's categorical slots (core/tokens.ts) - never new hues.
 * Colour follows the communication state in every view (pipeline, KPI keys, duty-plan diff, timeline).
 * Validated with the dataviz validate_palette.js in the order the states sit next to each other
 * (kommuniziert, geändert, nie, Person entfernt, gelöscht): light + dark PASS (2026-10-21). The amber slot is
 * left out: next to orange it fails the normal-vision floor. Red is never a series; "abgelehnt" is a status
 * and wears the serious token with its label.
 */
export interface Ac8Colors {
  kommuniziert: string;
  geaendert: string; // geändert, nicht kommuniziert  ==  Dienstplan "vorheriger Stand" (same meaning)
  nie: string;
  unbesetzt: string; // neutral + decal: absence of a person, not a category
  geloescht: string;
  entfernt: string;
  soll: string; // SOLL outline
  plan: string; // planned (filled)
  gap: string; // undercoverage
  rueckmeldung: Record<string, string>;
  erst: string;
  aenderung: string;
}

export function ac8Colors(t: ChartTokens): Ac8Colors {
  const s = t.series;
  return {
    kommuniziert: s[0],
    geaendert: s[1],
    nie: s[2],
    unbesetzt: t.neutral,
    geloescht: s[4],
    entfernt: s[6],
    soll: t.ink2,
    plan: t.seq[3],
    gap: s[1],
    rueckmeldung: {
      'automatisch akzeptiert': t.seq[2],
      akzeptiert: t.seq[5],
      versendet: t.seq[0],
      abgelehnt: t.serious,
      veraltet: t.neutral,
      'keine Rückmeldung': t.axis,
    },
    erst: s[0],
    aenderung: s[1],
  };
}

export const STAND_ORDER = ['kommuniziert', 'geändert, nicht kommuniziert', 'nie kommuniziert', 'unbesetzt', 'gelöscht'] as const;
export type StandKey = (typeof STAND_ORDER)[number];

export function standColor(c: Ac8Colors, stand: string): string {
  if (stand === 'kommuniziert') return c.kommuniziert;
  if (stand.startsWith('geändert') || stand.startsWith('vorheriger')) return c.geaendert;
  if (stand === 'nie kommuniziert') return c.nie;
  if (stand.startsWith('gelöscht')) return c.geloescht;
  if (stand.startsWith('Person entfernt')) return c.entfernt;
  return c.unbesetzt;
}

/** Short labels for the four duty-plan sources (ADR-051 rule v3); the full text is in the tooltip. */
export function quelleShort(q: string): string {
  if (q === 'kommuniziert') return 'kommuniziert';
  if (q.startsWith('vorheriger')) return 'vorheriger Stand';
  if (q.startsWith('Person entfernt')) return 'Person entfernt';
  if (q.startsWith('gelöscht')) return 'gelöscht';
  return q;
}

/** Decal patterns per state. aria decals are off by default (shared/chart-opts.ts ariaDecal); these are
 *  set per item where the shape must carry the state (unbesetzt, gelöscht, Unterdeckung). */
export const DECAL = {
  unbesetzt: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 5], rotation: Math.PI / 4, color: 'rgba(0,0,0,0.18)' },
  geloescht: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [3, 3], rotation: -Math.PI / 4, color: 'rgba(255,255,255,0.45)' },
  gap: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: 'rgba(255,255,255,0.5)' },
} as const;
