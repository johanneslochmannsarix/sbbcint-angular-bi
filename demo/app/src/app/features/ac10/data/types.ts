/** Row shapes of the AC-10 named queries (backend/queries/ac10/*.roles.json). Dates arrive as naive ISO strings. */

export interface StandRow {
  datenstand: string | null;
  gold_build_ts: string | null;
  regelversion: string | null;
  zeitfenster: string | null;
  fenster_von: string | null;
  fenster_bis: string | null;
  modell_heute: string | null;
  betriebsstellen_name_pct: number | null;
  hinweis_datenstand: string | null;
  hinweis_besetzungspflicht: string | null;
  hinweis_betriebsstellen: string | null;
  hinweis_geschlossene_schichten: string | null;
  hinweis_stammdaten: string | null;
}

export type ScopeArt = 'mandant' | 'depot' | 'haupttyp' | 'kategorie';
export interface ScopeRow {
  art: ScopeArt;
  ix: number;
  label: string;
  mandant: string;
  n_gesamt: number | null;
  n_offen: number | null;
  mandanten: number | null;
}

export interface JetztRow {
  heute: string;
  heute_ungeplant: number;
  heute_zwingend: number;
  heute_schichten: number;
  morgen_ungeplant: number;
  morgen_zwingend: number;
  morgen_schichten: number;
  woche_ungeplant: number;
  woche_zwingend: number;
  woche_schichten: number;
  heute_elemente: number;
  woche_elemente: number;
}

export interface FensterRow {
  ungeplant: number;
  ungeplant_zwingend: number;
  schichten: number;
  besetzungsquote: number | null;
  elemente_offen: number;
  elemente_vergangen: number;
  elemente_zukuenftig: number;
  mandant_gewaehlt: string | null;
  depot_gewaehlt: string | null;
  haupttyp_gewaehlt: string | null;
  kategorie_gewaehlt: string | null;
}

export interface TageRow {
  datum: string;
  jahr_kw: string;
  ungeplant: number;
  ungeplant_zwingend: number;
  schichten: number;
  elemente_offen: number;
}

export interface DepotTagRow {
  tenant_name: string;
  depot_name: string;
  datum: string;
  ungeplant: number;
  ungeplant_zwingend: number;
  schichten: number;
}

export interface StrukturRow {
  ebene: 'mandant' | 'depot';
  mandant: string;
  depot: string | null;
  ungeplant: number;
  ungeplant_zwingend: number;
  schichten: number;
  besetzungsquote: number | null;
}

export interface PersonaltypRow {
  tenant_name: string;
  haupttyp_name: string;
  ungeplant: number;
  ungeplant_zwingend: number;
  schichten: number;
  mandanten_des_typs: number;
}

export interface ElementRow {
  fahren_kategorie: string;
  datum: string;
  offen: number;
}

export interface PositionRow {
  position_sk: string;
  position_typ: 'Schicht' | 'Schichtelement ohne Schicht';
  mandant: string | null;
  depot: string | null;
  haupttyp: string | null;
  personaltyp: string | null;
  /** masked to a T- token unless the backend runs with -Real */
  position_name: string | null;
  planned_start: string | null;
  planned_end: string | null;
  is_offen: boolean;
  is_zwingend: boolean;
  fahren_kategorie: string | null;
  fahrelement_anzahl: number | null;
  /** masked to a T- token unless the backend runs with -Real */
  fahrelement_liste: string | null;
  von: string | null;
  nach: string | null;
}

export type Zwingend = 'alle' | 'zwingend' | 'nicht';
export const ZWINGEND_LABEL: Record<Zwingend, string> = { alle: 'Alle Schichten', zwingend: 'Nur zwingend', nicht: 'Nur nicht zwingend' };

export const TIER2 = 'Schichtelement ohne Schicht';
