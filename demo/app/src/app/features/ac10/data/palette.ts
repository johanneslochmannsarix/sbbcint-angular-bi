import { ChartTokens } from '../../../core/tokens';

/**
 * AC-10 colour jobs (dataviz procedure; validated with the skill's validate_palette.js, light + dark, 2026-10-21:
 * all checks pass, light contrast WARN for green / yellow / pink -> every categorical view carries a labelled legend
 * and the Detailliste is the table view).
 *
 * - magnitude (open shifts): the core sequential blue ramp, everywhere (heatmap cells, open Gantt bars, timeline).
 * - identity = LAND: Land = Mandant (customer rule), so a country's hue is the same for its Mandant (view 4) and its
 *   «Fahren <Land>» category (views 3 / 5). Blue is kept out of this set: it means «open». Italien 2A and the
 *   Verbindungsbahn Basel RB share their country's hue and carry a hatch (8 categories, 7 validated slots).
 * - the error Mandanten «(unbekannt)» / «(kein Mandant)» are neutral, never a hue.
 * Red never appears (report design system).
 */
export type Land = 'de' | 'ch' | 'it' | 'nl' | 'fr' | 'be';

const LAND_SLOT: Record<Land, number> = { de: 6, ch: 1, it: 2, nl: 3, fr: 4, be: 5 };

export function landHue(t: ChartTokens, land: Land | null): string {
  return land ? t.series[LAND_SLOT[land]] : t.neutral;
}

/** Mandant label -> Land, by the country word the label carries (labels shown as delivered, R7). */
export function landOfMandant(label: string | null | undefined): Land | null {
  const s = (label ?? '').toLowerCase();
  if (s.startsWith('(')) return null;
  if (s.includes('deutschland')) return 'de';
  if (s.includes('schweiz')) return 'ch';
  if (s.includes('italia')) return 'it';
  if (s.includes('nederland')) return 'nl';
  if (s.includes('france')) return 'fr';
  if (s.includes('belg')) return 'be';
  return null;
}

export interface KategorieStyle {
  land: Land | null;
  hatch: boolean;
}

/** fahren_kategorie -> its Land hue; the second position of a section (Italien 2A) and the Basel link are hatched. */
export function kategorieStyle(k: string): KategorieStyle {
  const s = k.toLowerCase();
  if (s.includes('basel')) return { land: 'ch', hatch: true };
  if (s.includes('italien')) return { land: 'it', hatch: /2a/.test(s) };
  if (s.includes('deutschland')) return { land: 'de', hatch: false };
  if (s.includes('schweiz')) return { land: 'ch', hatch: false };
  if (s.includes('niederlande')) return { land: 'nl', hatch: false };
  if (s.includes('frankreich')) return { land: 'fr', hatch: false };
  if (s.includes('belgien')) return { land: 'be', hatch: false };
  return { land: null, hatch: false };
}

/** Fixed category order (stack order follows geography, the two Italian positions side by side). */
export const KATEGORIE_ORDER = ['deutschland', 'schweiz', 'basel', 'italien 2a', 'italien', 'niederlande', 'belgien', 'frankreich'];
export function kategorieRank(k: string): number {
  const s = k.toLowerCase();
  const i = KATEGORIE_ORDER.findIndex((p) => s.includes(p));
  return i < 0 ? 99 : i;
}

/** echarts decal for a hatched category / item (applied per item, core ariaDecal keeps the automatic ones off). */
export function hatch(color: string): Record<string, unknown> {
  return { symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: Math.PI / 4, color };
}

const patterns = new Map<string, { image: HTMLCanvasElement; repeat: 'repeat' }>();
/**
 * The same hatch as a zrender pattern fill, for custom-series graphics (their style takes no decal): `bg` with
 * 45° stripes of `line`, 6 px period. Cached per colour pair.
 */
export function hatchFill(bg: string, line: string): { image: HTMLCanvasElement; repeat: 'repeat' } | string {
  const key = `${bg}|${line}`;
  const hit = patterns.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return bg;
  const c = document.createElement('canvas');
  c.width = c.height = 6;
  const g = c.getContext('2d');
  if (!g) return bg;
  g.fillStyle = bg;
  g.fillRect(0, 0, 6, 6);
  g.strokeStyle = line;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-1, 7);
  g.lineTo(7, -1);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(5, 7);
  g.lineTo(7, 5);
  g.stroke();
  const p = { image: c, repeat: 'repeat' as const };
  patterns.set(key, p);
  return p;
}

/** CSS twin of hatch() for HTML legend keys. */
export function hatchCss(color: string): string {
  return `repeating-linear-gradient(45deg, rgba(255,255,255,0.6) 0 1.5px, transparent 1.5px 4px), ${color}`;
}

export interface Ac10Colors {
  open: string;
  openStrong: string;
  openSoft: string;
  filled: string;
  filledLine: string;
  ramp: readonly string[];
  today: string;
}

export function ac10Colors(t: ChartTokens): Ac10Colors {
  return {
    open: t.seq[3],
    openStrong: t.seq[5],
    openSoft: t.seq[1],
    filled: t.grid,
    filledLine: t.axis,
    ramp: t.seq,
    today: t.ink,
  };
}
