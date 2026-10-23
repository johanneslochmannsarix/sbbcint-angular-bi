/** Row shapes of the AC-6 named queries (backend/queries/ac6/*.roles.json). Numbers may be null (BLANK). */

export interface StandRow {
  juengstes_ist: string | null;
  dispo_von: string | null;
  dispo_bis: string | null;
  versionen: number | null;
  elemente_ohne_version: number | null;
}

export type DimKind = 'version' | 'firma' | 'standort' | 'ptyp' | 'taet' | 'tag' | 'vts';

export interface DimRow {
  kind: DimKind;
  /** rank of the value among the column's non-blank values (tag: its musterwochentag_nr; vts: the version rank) */
  rang: number;
  label: string | null;
  /** standort: its Firma; taet: Fahren ja/nein; vts: the version name */
  parent: string | null;
  touren: number | null;
  elemente: number | null;
  dauer_h: number | null;
  standorte: number | null;
}

export interface KpiRow {
  tag: number | null;
  ist_gesamt: number;
  touren: number | null;
  tourelemente: number | null;
  dauer_h: number | null;
  dauer_touren_h: number | null;
  arbeitszeit_h: number | null;
  fahren_h: number | null;
  fahranteil: number | null;
  dauer_je_tour_h: number | null;
  standorte: number | null;
  sel_version: string | null;
  sel_firma: string | null;
  sel_standort: string | null;
  sel_ptyp: string | null;
  sel_taet: string | null;
}

export interface HeatRow {
  firma: string | null;
  tourstandort: string | null;
  tag: number | null;
  dauer_h: number | null;
  touren: number | null;
  tourelemente: number | null;
  fahren_h: number | null;
}

export interface HierRow {
  firma: string | null;
  tourstandort: string | null;
  personaltyp: string | null;
  taetigkeit: string | null;
  fahren: string | null;
  dauer_h: number | null;
  tourelemente: number | null;
  touren: number | null;
}

export interface WocheRow {
  stunde: number;
  art: 'h_ja' | 'h_nein' | 'h_leer' | 'touren';
  wert: number | null;
}

export interface DiffRow {
  kind: 'standort' | 'ptyp' | 'taet' | 'tag';
  label: string | null;
  nr: number | null;
  h_a: number | null;
  h_b: number | null;
  touren_a: number | null;
  touren_b: number | null;
  elemente_a: number | null;
  elemente_b: number | null;
}

export interface VergleichRow {
  seite: 'plan' | 'dispo';
  tourstandort: string | null;
  tag: number | null;
  h: number | null;
  touren: number | null;
  h_je_woche: number | null;
  touren_je_woche: number | null;
}

export interface WochenRow {
  kw: number;
  erster_tag: string | null;
  tage: number;
  dispo_h: number | null;
  dispo_touren: number | null;
  plan_h: number | null;
  plan_touren: number | null;
}

export interface KostenRow {
  version: string | null;
  code: number | null;
  kostenallokation: string | null;
  elemente: number | null;
  dauer_h: number | null;
  ohne_kostenstelle: number | null;
}

export interface TourenRow {
  tour_id: string;
  /** masked free text (T-…) unless the backend runs with -Real */
  tour: string | null;
  personaltyp: string | null;
  tag: number | null;
  start_ms: number | null;
  ende_ms: number | null;
  elemente: number | null;
  dauer_h: number | null;
  fahren_h: number | null;
}

export interface TourRow {
  element_id: string;
  tour: string | null;
  version: string | null;
  tourstandort: string | null;
  personaltyp: string | null;
  tour_start_ms: number | null;
  tour_ende_ms: number | null;
  start_ms: number | null;
  ende_ms: number | null;
  dauer_min: number | null;
  arbeitszeit_min: number | null;
  taetigkeit: string | null;
  fahren: string | null;
  startbahnhof: string | null;
  zielbahnhof: string | null;
  zugnummer: string | null;
  kostenallokation: string | null;
}
