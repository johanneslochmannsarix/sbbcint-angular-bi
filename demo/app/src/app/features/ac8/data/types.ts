/** Row shapes of the AC-8 named queries (backend/queries/ac8/*.roles.json). Person columns are pseudonyms. */

export interface StandRow {
  neuester_stand: string | null;
  erster_plantag: string | null;
  letzter_plantag: string | null;
}

export interface KpiRow {
  von: string;
  bis: string;
  schichten: number | null;
  kommuniziert: number | null;
  nicht_kommuniziert: number | null;
  geaendert_nicht_kommuniziert: number | null;
  nie_kommuniziert: number | null;
  unbesetzt: number | null;
  besetzt: number | null;
  schichtstunden: number | null;
  personen_mit_schicht: number | null;
  dienstplan: number | null;
  dp_kommuniziert: number | null;
  dp_vorheriger_stand: number | null;
  dp_geloescht: number | null;
  dp_person_entfernt: number | null;
  abgelehnt: number | null;
  veraltet: number | null;
  personen_abwesend: number | null;
  abwesenheiten: number | null;
}
export type KpiKey = Exclude<keyof KpiRow, 'von' | 'bis'>;

export interface PipelineRow {
  quelle: 'fact_shift' | 'fact_dienstplan';
  stand: string;
  rueckmeldung_status: number | null;
  rueckmeldung_label: string | null;
  weicht_ab: boolean | null;
  n: number | null;
  ohne_person: number | null;
}

export interface RiverRow {
  tag: string;
  kategorie: string | null;
  versionen: number;
}

export interface VersionRow {
  shift_snapshot_sk: string;
  shift_sk: string;
  created_ts: string | null;
  snapshot_start: string | null;
  version_nr: number;
  rueckmeldung_status: number | null;
  ist_aktueller_stand: boolean | null;
  schicht_im_plan: boolean | null;
  vorlauf_h: number | null;
}

export interface ShiftVersionRow {
  shift_snapshot_sk: string;
  person_sk: string | null;
  version_nr: number;
  created_ts: string | null;
  snapshot_start: string | null;
  snapshot_end: string | null;
  rueckmeldung_status: number | null;
  rueckmeldung_status_label: string | null;
  snapshot_type_code: number | null;
  ist_aktueller_stand: boolean | null;
  schicht_im_plan: boolean | null;
  ist_pointer: boolean | null;
  ist_dienstplan: boolean | null;
  dienstplan_quelle: string | null;
  kommunikationsstand: string | null;
  plan_start: string | null;
  plan_ende: string | null;
  plan_person_sk: string | null;
}

export interface ShiftRow {
  shift_sk: string;
  person_sk: string | null;
  shift_name: string | null;
  planned_date: string;
  planned_start: string | null;
  planned_end: string | null;
  shift_worker_type_name: string | null;
  ist_kommuniziert: boolean | null;
  kommunikationsstand: string;
  rueckmeldung_status: number | null;
  rueckmeldung_status_label: string | null;
  kommuniziert_start: string | null;
  kommuniziert_ende: string | null;
  juengster_stand_start: string | null;
  juengster_stand_ende: string | null;
  weicht_von_juengstem_stand_ab: boolean | null;
}

export interface DienstplanRow {
  shift_sk: string;
  shift_snapshot_sk: string | null;
  person_sk: string | null;
  plan_person_sk: string | null;
  shift_name: string | null;
  shift_worker_type_name: string | null;
  dienstplan_datum: string;
  dienstplan_start: string | null;
  dienstplan_ende: string | null;
  plan_start: string | null;
  plan_ende: string | null;
  dienstplan_quelle: string;
  rueckmeldung_status_label: string | null;
  schicht_im_plan: boolean | null;
  weicht_vom_plan_ab: boolean | null;
}

export interface PersonRow {
  person_sk: string;
  person_name: string | null;
  worker_type_name: string | null;
  is_active: boolean | null;
}

export interface PlanningRow {
  shift_planning_sk: string;
  planning_name: string | null;
  soll: number | null;
  soll_h: number | null;
}

export interface SollRow {
  virtual_shift_sk: string;
  weekday_num: number;
  start_ms: number;
  end_ms: number;
  worker_type_name: string | null;
  soll: number;
  soll_h: number;
}

/** kommunikationsstand values of fact_shift (ADR-049) plus the deleted state from fact_dienstplan (rule v3). */
export type Stand = 'kommuniziert' | 'geändert, nicht kommuniziert' | 'nie kommuniziert' | 'unbesetzt' | 'gelöscht';
export const DIENSTPLAN_QUELLEN = [
  'kommuniziert',
  'vorheriger Stand – Änderung nicht kommuniziert',
  'Person entfernt – Kommunikation nicht nachweisbar',
  'gelöscht – Kommunikation nicht nachweisbar',
] as const;
