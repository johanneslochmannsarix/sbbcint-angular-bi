import { ChartTokens } from '../../../core/tokens';
import { Ga, StatusCode } from './types';

/**
 * AC-7 semantic colours, from the shell's categorical slots (core/tokens.ts), never new hues. Colour follows the
 * Geschäftsart in every view (timeline bars, sankey, box plot, drawer): AÜ = slot 0, DL = slot 2, AÜ+DL (a person
 * on both, never a stint) = slot 6. Validated with the dataviz validate_palette.js in that adjacency, light + dark
 * PASS (2026-10-21); light DL is below 3:1 against the surface (WARN) -> every view carries a legend / direct label
 * and the Formular is the table view.
 * Status is NOT a colour series (red is never a series, no red/green pair): aktiv = solid ink, inaktiv = the neutral
 * token, plus the glyph ■ / □ wherever the word is not written out.
 */
export interface Ac7Colors {
  ga: Record<Ga, string>;
  status: Record<StatusCode, string>;
  /** stint 2 (the one before the newest) wears its Geschäftsart at this opacity */
  older: number;
  today: string;
  austritt: string;
}

export function ac7Colors(t: ChartTokens): Ac7Colors {
  return {
    ga: { 'AÜ': t.series[0], DL: t.series[2], 'AÜ+DL': t.series[6] },
    status: { AKTIV: t.ink2, INAKTIV: t.neutral },
    older: 0.5,
    today: t.ink,
    austritt: t.ink,
  };
}

export const STATUS_GLYPH: Record<StatusCode, string> = { AKTIV: '■', INAKTIV: '□' };
export const GA_ORDER: readonly Ga[] = ['AÜ', 'DL', 'AÜ+DL'];
export const GA_NAME: Record<Ga, string> = { 'AÜ': 'Arbeitnehmerüberlassung', DL: 'Dienstleistung', 'AÜ+DL': 'beides' };
