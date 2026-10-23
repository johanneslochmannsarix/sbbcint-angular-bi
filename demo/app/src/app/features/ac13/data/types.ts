/** Row shapes of the AC-13 named queries (backend/queries/ac13/*.roles.json). Numbers may be null (BLANK). */

export interface StandRow {
  stand: string | null;
  stand_local: string | null;
  stand_utc: string | null;
  gold_build_ts: string | null;
  laufdatum: string | null;
  vormonat: string | null;
  daten_ab: string | null;
  erste_tour: string | null;
  letzte_tour: string | null;
  touren: number | null;
  personen: number | null;
  regel_arbeitszeit: string | null;
  regel_verkauf: string | null;
  regel_schulung: string | null;
  regel_uebernachtung: string | null;
  regel_paar: string | null;
  regel_ohne_eintrag: string | null;
  kontenregel: string | null;
  schwelle_12h: number | null;
  schwelle_14h: number | null;
  spitzentage: number | null;
  touren_ohne_bst: number | null;
  az_negativ: number | null;
  hinweis_namen: string | null;
  hinweis_arbeitszeit: string | null;
  hinweis_angerechnet: string | null;
  hinweis_14h: string | null;
  hinweis_verkauf: string | null;
  hinweis_schulung: string | null;
  hinweis_uebernachtung: string | null;
  hinweis_abwesenheit: string | null;
  hinweis_ohne_eintrag: string | null;
  hinweis_standort: string | null;
  hinweis_datenstand: string | null;
  hinweis_spitzentage: string | null;
}

export type DimKind = 'monat' | 'standort' | 'haupttyp' | 'konto';

export interface DimRow {
  kind: DimKind;
  /** standort / haupttyp: rank in the sorted list (the param value); konto: konto_sortierung; monat: 0 */
  rang: number;
  label: string | null;
  /** monat: «Vormonat» or ''; standort: Firma; konto: konto_typ (Ruhetag / Urlaub / übrige) */
  parent: string | null;
  touren: number | null;
}

export interface MonatRow {
  monat: string;
  touren: number;
  besetzt: number;
  offen: number;
  personen: number;
  az_h: number;
  plan_h: number;
  anger_h: number;
  angerechnet_touren: number;
  ge12: number;
  ge14: number;
  ue_touren: number;
  paare: number;
  verkauft: number;
  schulungen: number;
  familie: number;
  uebrige: number;
  ohne_eintrag: number;
}

export interface StandortTagRow {
  standort: string;
  datum: string;
  touren: number;
  besetzt: number;
  offen: number;
  verkauft: number;
  offen_nicht_verkauft: number;
  familie: number;
  /** Q1 ruling (a): «übrige Abwesenheit» + «ohne Eintrag», only ever as their sum at this grain */
  uebrige_oder_ohne: number;
}

export interface GridRow {
  person: string;
  kennung: string | null;
  heimatstandort: string | null;
  datum: string;
  touren: number;
  uebernachtung: number;
  ruhe: number;
  urlaub: number;
}

export interface BoxRow {
  tour_standort: string;
  ist_gesamt: boolean;
  touren: number;
  min: number | null;
  p05: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
  ueber_24h: number;
  negativ: number;
  angerechnet_touren: number;
  ge12: number;
  ge14: number;
}

export interface PunktRow {
  tour: string;
  tour_standort: string | null;
  datum: string;
  arbeitszeit_min: number | null;
  angerechnet_min: number | null;
  plandauer_min: number | null;
  ge12: number;
  ge14: number;
  offen: number;
}

export interface KanteRow {
  start: string | null;
  ziel: string | null;
  legs: number;
  paare: number;
  folgetag: number;
}

export interface UeRow {
  tour: string;
  person: string | null;
  kennung: string | null;
  heimatstandort: string | null;
  tourennummer: string | null;
  tour_standort: string | null;
  datum: string;
  plan_beginn: string | null;
  plan_ende: string | null;
  start: string | null;
  ziel: string | null;
  rolle: string | null;
  folgetour: number;
  ort: string | null;
  partner_beginn: string | null;
  partner_tourennummer: string | null;
  am_folgetag: number;
}

export interface RegelRow {
  monat: string;
  dienstleister: string | null;
  verkauft: number;
  besetzt: number;
}

export interface TourListRow {
  tour: string;
  person: string | null;
  kennung?: string | null;
  tourennummer: string | null;
  tour_standort: string | null;
  personaltyp: string | null;
  datum: string;
  plan_beginn: string | null;
  plan_ende: string | null;
  arbeitszeit_min: number | null;
  angerechnet_min: number | null;
  offen?: number;
  verkauft?: number;
  schulung?: number;
  start?: string | null;
  ziel?: string | null;
  rolle: string | null;
}

export interface TourRow {
  tour: string;
  person: string | null;
  kennung: string | null;
  tourennummer: string | null;
  tour_standort: string | null;
  tour_firma: string | null;
  personaltyp: string | null;
  haupttyp: string | null;
  datum: string;
  plan_beginn: string | null;
  plan_ende: string | null;
  plandauer_min: number | null;
  pause_min: number | null;
  azu_min: number | null;
  unbezahlt_min: number | null;
  dienstfahrt_min: number | null;
  arbeitszeit_min: number | null;
  angerechnet_min: number | null;
  ge12: number;
  ge14: number;
  start: string | null;
  ziel: string | null;
  offen: number;
  verkauft: number;
  dienstleister: string | null;
  schulung: number;
  schulung_elemente: number | null;
  rolle: string | null;
  ort: string | null;
  partner_beginn: string | null;
  partner_tourennummer: string | null;
  am_folgetag: number;
  kommunikationsstand: string | null;
}
