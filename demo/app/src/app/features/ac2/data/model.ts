import { Injectable, computed, signal } from '@angular/core';
import { Env, QueryParams, Tenant } from './api';
import { dayMs } from '../../../core/format';
import { createQuery } from './query';
import { HELD, STATUS_FALLBACK_LABEL, STATUS_ORDER, StatusCode } from './tokens';

type S = string | null;
type N = number | null;

/** Row shapes of the named queries (backend/queries/README.md §4). Person columns arrive pseudonymised. */
export interface PersonRow { person_sk: string; person_name: S; tenant_sk?: S; tenant_name?: S; pairs: N }
export interface QualRow { qualification_sk: string; qualification_name: S }
export interface PairRow { person_sk: string; qualification_sk: string; status_code: StatusCode; valid_from: S; valid_to: S }
export interface StatusRow { status_code: StatusCode; label_de: S; sort_order: N }
export interface StatusByQualRow {
  qualification_sk: string; qualification_name: S; anzahl_gueltig: N; anzahl_lt_90: N; anzahl_abgelaufen: N;
  anzahl_noch_nicht_gueltig: N; anzahl_ohne_datum: N; anzahl_fehlt: N;
}
export interface AsOfRow { datenstand_local: S; batch_time?: S }
export interface ExpiryRow { person_sk: string; person_name: S; tenant_name?: S; qualification_name: S; status_code: StatusCode; valid_to: S }
export interface DetailRow { qualification_sk: string; qualification_name: S; status_code: StatusCode; valid_from: S; valid_to: S }

export interface Cell { status: StatusCode; from: number | null; to: number | null; rows: number }
export interface Person {
  key: string;            // pseudonym (P-xxxxxx) in every mode
  name: string | null;    // pseudonym in masked mode, real name only in -Real mode; null = no name in the source
  orgSk: string | null;
  org: string | null;
  cells: Map<string, Cell>; // qualification_sk -> held cell (MISSING_NEVER is the absence of a cell)
  gaps: number;            // qualifications without any row other than MISSING_NEVER
  expired: number;
}
export interface Qualification { sk: string; name: string; index: number }

export interface Model {
  tenant: Tenant;
  env: Env;
  persons: Person[];
  quals: Qualification[];
  qualBySk: Map<string, Qualification>;
  personByKey: Map<string, Person>;
  orgs: { sk: string; name: string; people: number }[];
  hasOrg: boolean;
  noName: number;
  /** pairs with two source rows (RT&S alias rows, RULING 2026-10-12) */
  duplicatePairs: number;
}

export function label(p: Person, masked: boolean): string {
  if (p.name == null) return `${p.key} (ohne Namen)`;
  return masked ? p.key : p.name;
}

@Injectable({ providedIn: 'root' })
export class DataStore {
  readonly tenant = signal<Tenant>('CARGOCONTROL');
  readonly env = signal<Env>('PROD');

  readonly base = computed<QueryParams>(() => ({ tenant: this.tenant(), env: this.env() }));

  readonly asOf = createQuery<AsOfRow>(() => ({ name: 'data_as_of', params: this.base() }));
  readonly statuses = createQuery<StatusRow>(() => ({ name: 'status_codes', params: this.base() }));
  readonly qualsQ = createQuery<QualRow>(() => ({ name: 'qualifications', params: this.base() }));
  readonly personsQ = createQuery<PersonRow>(() => ({ name: 'persons', params: this.base() }));
  readonly pairsQ = createQuery<PairRow>(() => ({ name: 'pairs', params: this.base() }));
  readonly sbq = createQuery<StatusByQualRow>(() => ({ name: 'status_by_qualification', params: this.base() }));

  /** the three queries the person x qualification model is built from */
  readonly modelQueries = [this.personsQ, this.qualsQ, this.pairsQ];

  readonly masked = computed(() => (this.personsQ.result()?.mode ?? 'masked') === 'masked');

  readonly statusLabel = computed<Record<StatusCode, string>>(() => {
    const out = { ...STATUS_FALLBACK_LABEL };
    for (const r of this.statuses.rows()) if (r.label_de && r.status_code in out) out[r.status_code] = r.label_de;
    return out;
  });

  readonly model = computed<Model | null>(() => {
    const pr = this.personsQ.result();
    const qr = this.qualsQ.result();
    const ar = this.pairsQ.result();
    // only a consistent triple: all three for the same tenant/env
    if (!pr || !qr || !ar) return null;
    if (pr.tenant !== qr.tenant || pr.tenant !== ar.tenant || pr.env !== qr.env || pr.env !== ar.env) return null;
    if (!pr.tenant || !pr.env) return null; // demo core: tenant/env are nullable (platform_metrics has none)

    const quals: Qualification[] = qr.rows.map((q, index) => ({ sk: q.qualification_sk, name: q.qualification_name ?? '(ohne Bezeichnung)', index }));
    const qualBySk = new Map(quals.map((q) => [q.sk, q]));
    const personByKey = new Map<string, Person>();
    for (const r of pr.rows) {
      if (personByKey.has(r.person_sk)) continue; // CC: one org per person (probe 2026-10-20)
      personByKey.set(r.person_sk, {
        key: r.person_sk, name: r.person_name, orgSk: r.tenant_sk ?? null, org: r.tenant_name ?? null,
        cells: new Map(), gaps: 0, expired: 0,
      });
    }
    let duplicatePairs = 0;
    for (const r of ar.rows) {
      const p = personByKey.get(r.person_sk);
      if (!p || !qualBySk.has(r.qualification_sk)) continue;
      const prev = p.cells.get(r.qualification_sk);
      const cell: Cell = { status: r.status_code, from: dayMs(r.valid_from), to: dayMs(r.valid_to), rows: 1 };
      if (prev) {
        duplicatePairs++;
        cell.rows = prev.rows + 1;
        if (STATUS_ORDER.indexOf(prev.status) <= STATUS_ORDER.indexOf(cell.status)) {
          prev.rows = cell.rows;
          continue;
        }
      }
      p.cells.set(r.qualification_sk, cell);
    }
    const persons = [...personByKey.values()];
    for (const p of persons) {
      p.gaps = quals.length - p.cells.size;
      p.expired = [...p.cells.values()].filter((c) => c.status === 'EXPIRED').length;
    }
    const orgMap = new Map<string, { sk: string; name: string; people: number }>();
    for (const p of persons) {
      if (!p.orgSk) continue;
      const o = orgMap.get(p.orgSk) ?? { sk: p.orgSk, name: p.org ?? '(ohne Bezeichnung)', people: 0 };
      o.people++;
      orgMap.set(p.orgSk, o);
    }
    return {
      tenant: pr.tenant, env: pr.env, persons, quals, qualBySk, personByKey,
      orgs: [...orgMap.values()].sort((a, b) => b.people - a.people),
      hasOrg: orgMap.size > 0,
      noName: persons.filter((p) => p.name == null).length,
      duplicatePairs,
    };
  });

  /** Report reference numbers (Übersicht cards): totals of status_by_qualification. */
  readonly totals = computed(() => {
    const t: Record<StatusCode, number> = { VALID_GT_90: 0, VALID_LT_90: 0, NOT_YET_VALID: 0, EXPIRED: 0, DATES_MISSING: 0, MISSING_NEVER: 0 };
    for (const r of this.sbq.rows()) {
      t.VALID_GT_90 += r.anzahl_gueltig ?? 0;
      t.VALID_LT_90 += r.anzahl_lt_90 ?? 0;
      t.EXPIRED += r.anzahl_abgelaufen ?? 0;
      t.NOT_YET_VALID += r.anzahl_noch_nicht_gueltig ?? 0;
      t.DATES_MISSING += r.anzahl_ohne_datum ?? 0;
      t.MISSING_NEVER += r.anzahl_fehlt ?? 0;
    }
    return t;
  });

  readonly heldStatuses = HELD;
}
