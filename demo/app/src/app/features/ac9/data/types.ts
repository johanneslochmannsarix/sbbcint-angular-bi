/**
 * Row shapes of the AC-9 named queries (backend/queries/ac9/README.md). Order names and Tournummern arrive as
 * T-… tokens (the real text only under run.ps1 -Real); tours as pseudo-ids D-…; the one person column as P-….
 */
export type GaCode = 'AUE' | 'DL';
export type KatCode = 'int' | 'nat' | 'res' | 'll' | 'ohne';

export interface StandRow {
  ingested_max: string | null;
  ist_ende_max: string | null;
  erster_ist_monat: string | null;
  letzter_ist_monat: string | null;
  erster_plan_monat: string | null;
  letzter_plan_monat: string | null;
  touren: number | null;
  touren_ist: number | null;
  auftraege: number | null;
}

interface Hours {
  touren: number;
  brutto_h: number;
  netto_h: number;
  pause_h: number;
  azu_h: number;
  fahrt_h: number;
  avg_h: number | null;
  ue10: number;
  ue12: number;
  ue14: number;
  abweichungen: number;
  touren_int: number;
  touren_sbbcd: number;
}

export interface MonatRow extends Hours {
  year_month_ist: string;
  geschaeftsart: string | null;
  ga_total: boolean;
  auftrag_echo: string | null;
}

export interface KpiRow extends Hours {
  geschaeftsart: string | null;
  ga_total: boolean;
  rest_h: number;
  anteil_pause: number | null;
  anteil_azu: number | null;
  anteil_fahrt: number | null;
  anteil_int: number | null;
  quote: number | null;
  quote_abgeschlossen: number;
  quote_fehlt: number;
  auftraege: number;
  auftrag_echo: string | null;
}

export interface QuoteRow {
  plan_monat: string;
  geschaeftsart: string | null;
  ga_total: boolean;
  touren: number;
  abgeschlossen: number;
  mit_ist: number;
  fehlt: number;
  quote: number | null;
  auftrag_echo: string | null;
}

export interface AuftragListeRow {
  dor_name: string | null;
  /** the order's filter handle in every mode (T-…); dor_name is the label (token masked, name under -Real) */
  auftrag_token: string | null;
  geschaeftsart: string | null;
  kategorie_auftrag: string | null;
  erster_monat: string | null;
  letzter_monat: string | null;
  touren: number;
  touren_ist: number;
  netto_h: number;
}

export interface AuftragRow {
  dor_name: string | null;
  auftrag_token: string | null;
  geschaeftsart: string | null;
  kategorie_auftrag: string | null;
  touren: number;
  brutto_h: number;
  netto_h: number;
  pause_h: number;
  azu_h: number;
  fahrt_h: number;
  avg_h: number | null;
  ue12: number;
  ue14: number;
  abweichungen: number;
}

export interface PunktRow {
  tour: string;
  dor_name: string | null;
  geschaeftsart: string | null;
  kategorie_auftrag: string | null;
  year_month_ist: string | null;
  ist_start: string | null;
  ist_dauer_h: number | null;
  netto_h: number | null;
  plan_dauer_h: number | null;
  gap_h: number | null;
}

export interface TagRow {
  datum: string;
  touren: number;
  netto_h: number;
  ue12: number;
  auftrag_echo: string | null;
}

export interface TourRow {
  tour: string;
  dor_name?: string | null;
  tourbezeichnung: string | null;
  geschaeftsart: string | null;
  kategorie_auftrag: string | null;
  preiskategorie: string | null;
  year_month_ist: string | null;
  plan_monat: string | null;
  plan_start: string | null;
  plan_ende: string | null;
  plan_dauer_h: number | null;
  ist_start: string | null;
  ist_ende: string | null;
  ist_dauer_h: number | null;
  netto_h: number | null;
  pause_h: number | null;
  azu_h: number | null;
  fahrt_h: number | null;
  ist_vollstaendig: boolean | null;
  tour_abgeschlossen: boolean | null;
  n_elemente: number | null;
  n_elemente_ist: number | null;
  auftrag_echo?: string | null;
}

export interface ElementRow {
  person_sk: string | null;
  zeitart: string | null;
  taetigkeit: string | null;
  ist_start: string | null;
  ist_ende: string | null;
  ist_dauer_h: number | null;
  ist_vollstaendig: boolean | null;
  year_month: string | null;
  plan_start: string | null;
  plan_ende: string | null;
}

export interface PersonRow {
  year_month: string;
  dor_name: string | null;
  geschaeftsart: string | null;
  elemente: number;
  brutto_h: number;
  netto_h: number;
  touren: number;
}

export const GA_OF: Record<GaCode, string> = { AUE: 'AÜ', DL: 'DL' };
export const GA_CODE: Record<string, GaCode> = { 'AÜ': 'AUE', DL: 'DL' };
export const GA_LABEL: Record<string, string> = { 'AÜ': 'Arbeitnehmerüberlassung', DL: 'Dienstleistung' };

/** The order categories of the SBB-CD Dienstleistung (kategorie_auftrag), in the report's order. */
export const KATS: readonly { code: KatCode; label: string; model: string | null }[] = [
  { code: 'int', label: 'International', model: 'Internationale Leistungen' },
  { code: 'nat', label: 'National', model: 'Nationale Leistungen' },
  { code: 'll', label: 'Langläufer Köln–Basel', model: 'Langläufer Köln-Basel' },
  { code: 'res', label: 'Reserven', model: 'Reserven' },
  { code: 'ohne', label: 'ohne Kategorie', model: null },
];
export function katOf(model: string | null | undefined): (typeof KATS)[number] {
  return KATS.find((k) => k.model === (model ?? null)) ?? KATS[KATS.length - 1];
}
