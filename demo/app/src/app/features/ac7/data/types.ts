/** Row shapes of the AC-7 named queries (backend/queries/ac7/*.roles.json). Dates arrive as naive 'YYYY-MM-DDT00:00:00'. */

export type StatusCode = 'AKTIV' | 'INAKTIV';
/** model labels; the request value (`ga` param) is the ASCII key */
export type Ga = 'AÜ' | 'DL' | 'AÜ+DL';
export type GaKey = 'AU' | 'DL' | 'AU_DL';
export const GA_KEY: Record<Ga, GaKey> = { 'AÜ': 'AU', DL: 'DL', 'AÜ+DL': 'AU_DL' };
export const GA_OF_KEY: Record<GaKey, Ga> = { AU: 'AÜ', DL: 'DL', AU_DL: 'AÜ+DL' };
export const STATUS_LABEL: Record<StatusCode, string> = { AKTIV: 'aktiv', INAKTIV: 'inaktiv' };

export interface ListeRow {
  person_sk: string;
  nachname: string | null;
  vorname: string | null;
  status_code: StatusCode;
  status: string | null;
  geschaeftsart: Ga;
  taetigkeit: string | null;
  arbeitszeit_monat_h: number | null;
  arbeitszeit_woche_h: number | null;
  vertrag_gueltig: boolean | null;
  eintritt: string | null;
  austritt: string | null;
  einsatz1_von: string | null;
  einsatz1_bis: string | null;
  einsatz1_ort: string | null;
  einsatz1_anzahl_orte: number | null;
  einsatz1_auftrag: string | null;
  einsatz1_geschaeftsart: Ga | null;
  einsatz2_von: string | null;
  einsatz2_bis: string | null;
  einsatz2_ort: string | null;
  einsatz2_anzahl_orte: number | null;
  einsatz2_auftrag: string | null;
  einsatz2_geschaeftsart: Ga | null;
  anzahl_verleihstationen: number | null;
  erster_einsatz_von: string | null;
  letzter_einsatz_bis: string | null;
}

export interface KpiRow {
  personen: number | null;
  personen_status_basis: number | null;
  aktiv: number | null;
  inaktiv: number | null;
  personen_ga_basis: number | null;
  mit_au: number | null;
  nur_dl: number | null;
  nur_au: number | null;
  au_und_dl: number | null;
  jahr_heute: number | null;
  austritt_jahr: number | null;
  austritt_vorjahr: number | null;
  austritt_geplant: number | null;
  mit_austritt: number | null;
  mit_einsatz2: number | null;
  einsatz1_geplant: number | null;
  ohne_arbeitszeit: number | null;
}

export interface FlussRow { taetigkeit: string | null; geschaeftsart: Ga | null; status_code: StatusCode | null; personen: number | null }
export interface ArbeitszeitRow { stunden: number | null; status_code: StatusCode | null; personen: number | null }
export interface OrtRow { rang: number; ort: string; personen_einsatz1: number | null; personen_einsatz2: number | null; personen: number | null }
export interface TaetigkeitRow { rang: number; taetigkeit: string; personen: number | null }
export interface AuftragRow {
  rang: number;
  auftrag: string;
  auftrag_token: string;
  geschaeftsart: Ga | null;
  personen_einsatz1: number | null;
  personen_einsatz2: number | null;
}
export interface StandRow { datenstand_local: string | null }

export interface LocationEntry {
  id: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
  kind: string;
  status: 'ok' | 'ambiguous' | 'absent' | 'no_coord' | 'withheld';
}
export interface LocationsResponse { env: string; source: string; locations: LocationEntry[]; counts: Record<string, number>; fetched_at: string }

/** The «offen» items the PDF prints as placeholders too. Never filled here. */
export const OFFEN = [
  { key: 'firma', label: 'Firma / Betrieb', who: 'Marcel Ludwig (RT&S)' },
  { key: 'aueg', label: 'AÜG-Erlaubnisnummer', who: 'Marcel Ludwig (RT&S)' },
  { key: 'sitz', label: 'Hauptsitz / Niederlassung', who: 'Marcel Ludwig (RT&S)' },
  { key: 'entleiher', label: 'Entleiher und Branche je AÜ-Auftrag (Zuordnung der Auftragsnamen)', who: 'Marcel Ludwig (RT&S)' },
  { key: 'dl', label: 'Gehören DL-Aufträge (u. a. SBB Cargo Deutschland) auf die Liste?', who: 'Marcel Ludwig (RT&S)' },
  { key: 'pop', label: 'Nur verliehene Personen auf der Liste?', who: 'Marcel Ludwig (RT&S)' },
  { key: 'vz', label: 'Schwelle Vollzeit / Teilzeit / geringfügig', who: 'Marcel Ludwig (RT&S)' },
  { key: 'sax35', label: 'Schlüssel zur Person für Austritt und AÜ-Kennzeichen', who: 'SaxMS (SAX-35)' },
  { key: 'sax37', label: 'Eintrittsdatum, Bedeutung von AÜ-Kennzeichen und Pensum', who: 'SaxMS (SAX-37)' },
] as const;
