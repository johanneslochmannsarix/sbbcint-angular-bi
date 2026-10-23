/** Row shapes of the AC-4 named queries (backend/queries/ac4/*.roles.json). Values arrive masked. */

export interface StandRow {
  erster_plantag: string | null;
  letzter_plantag: string | null;
  juengstes_ist: string | null;
  touren: number | null;
  tourelemente: number | null;
  schichten_kommunikation: number | null;
  touren_planung: number | null;
  jup_versionen: number | null;
}

export interface DimRow {
  kind: 'firma' | 'standort' | 'ptyp' | 'taet' | 'monat';
  key: string;
  label: string | null;
  parent: string | null;
  rang: number | null;
}

export interface MonatRow {
  planmonat: string | null;
  ist_gesamt: boolean;
  touren: number | null;
  tourelemente: number | null;
  plandauer_touren_h: number | null;
  plandauer_h: number | null;
  fahren_h: number | null;
  dauer_je_tour_h: number | null;
  fahranteil: number | null;
  ist_erfassung: number | null;
  personen: number | null;
  anteil_person: number | null;
  touren_anger: number | null;
  anger_h: number | null;
  plan_anger_h: number | null;
  touren_beendet: number | null;
  touren_ist: number | null;
  touren_ist_alle_fahr: number | null;
  elemente_mit_ist: number | null;
  elemente_vergangen: number | null;
  plan_mit_ist_h: number | null;
  ist_mit_ist_h: number | null;
  ist_zu_plan: number | null;
  median_beginn: number | null;
  median_dauer: number | null;
  beginn_spaeter: number | null;
  beginn_frueher: number | null;
  beginn_innerhalb: number | null;
  dauer_laenger: number | null;
  dauer_kuerzer: number | null;
  dauer_innerhalb: number | null;
}

export interface StandortRow {
  firma: string | null;
  tourstandort: string | null;
  depot_sk: string | null;
  touren: number | null;
  tourelemente: number | null;
  plandauer_touren_h: number | null;
  plandauer_h: number | null;
  fahren_h: number | null;
  dauer_je_tour_h: number | null;
  fahranteil: number | null;
  anteil_person: number | null;
  personen: number | null;
  ist_erfassung: number | null;
  elemente_mit_ist: number | null;
  touren_anger: number | null;
}

export interface TaetRow {
  taetigkeit: string | null;
  worker_activity_sk: string | null;
  fahren: string | null;
  tourelemente: number | null;
  plandauer_h: number | null;
  anteil_auswahl: number | null;
  elemente_mit_ist: number | null;
  elemente_vergangen: number | null;
}

export interface PtypRow {
  personaltyp_tour: string | null;
  personaltyp_person: string | null;
  quelle: string | null;
  person_zuordnung: string | null;
  fahren: string | null;
  tourelemente: number | null;
  plandauer_h: number | null;
}

export interface KalenderRow {
  tag: string;
  touren: number | null;
  plandauer_h: number | null;
  fahren_h: number | null;
}

export interface JupRow {
  jup_version: string | null;
  musterwochentag: string | null;
  musterwochentag_nr: number | null;
  einsatzart: string | null;
  touren: number | null;
  tourelemente: number | null;
  dauer_h: number | null;
  fahren_h: number | null;
  arbeitszeit_h: number | null;
  touren_anger: number | null;
}

export interface PlanIstRow {
  element_id: string;
  tour_id: string | null;
  planmonat: string | null;
  depot_sk: string | null;
  tourstandort: string | null;
  taetigkeit: string | null;
  fahren: string | null;
  plandauer_min: number | null;
  abw_beginn_min: number;
  abw_dauer_min: number;
  plan_stunde: number | null;
}

export interface KommKpiRow {
  planmonat: string | null;
  ist_gesamt: boolean;
  schichten: number | null;
  kommuniziert: number | null;
  akzeptiert: number | null;
  akzeptiert_automatisch: number | null;
  von_hand: number | null;
  vor_geaendert: number | null;
  nach_geaendert: number | null;
  nach_neu_versendet: number | null;
  nach_nicht_versendet: number | null;
  anteil_vor: number | null;
  anteil_nach: number | null;
  anteil_akzeptiert: number | null;
  versionen_je_schicht: number | null;
  folgeversionen: number | null;
  aend_vor: number | null;
  aend_nach: number | null;
  aend_tourelemente: number | null;
  aend_besetzung: number | null;
  aend_zeit: number | null;
  identisch: number | null;
}

export interface KommRow {
  planmonat: string | null;
  verlauf: string | null;
  akzeptanzart: string | null;
  kommunikationsstand: string | null;
  schichten: number | null;
  versionen: number | null;
}

export interface AngerRow {
  planmonat: string;
  touren: number | null;
  touren_anger: number | null;
  a_min: number | null;
  a_p05: number | null;
  a_p25: number | null;
  a_p50: number | null;
  a_p75: number | null;
  a_p95: number | null;
  a_max: number | null;
  p_p50: number | null;
  gleich_plan: number | null;
}

export interface AngerHistRow {
  planmonat: string;
  bucket: number;
  touren: number;
}

export interface TourenRow {
  tour_id: string;
  tour: string | null;
  tour_plandatum: string | null;
  tour_planbeginn: string | null;
  tour_planende: string | null;
  personaltyp_tour: string | null;
  abdeckung: string | null;
  anger_min: number | null;
  tourelemente: number | null;
  plandauer_h: number | null;
  fahren_h: number | null;
  elemente_mit_ist: number | null;
  ist_erfassung: number | null;
}

export interface TourRow {
  element_id: string;
  element_nr: number | null;
  taetigkeit: string | null;
  fahren: string | null;
  element_planbeginn: string | null;
  element_planende: string | null;
  element_istbeginn: string | null;
  element_istende: string | null;
  plandauer_min: number | null;
  istdauer_min: number | null;
  startbahnhof: string | null;
  zielbahnhof: string | null;
  person_zuordnung: string | null;
  tour: string | null;
  tourstandort: string | null;
  firma: string | null;
  personaltyp_tour: string | null;
  planmonat: string | null;
  tour_planbeginn: string | null;
  tour_planende: string | null;
  tour_istbeginn: string | null;
  tour_istende: string | null;
  abdeckung: string | null;
  anger_min: number | null;
}
