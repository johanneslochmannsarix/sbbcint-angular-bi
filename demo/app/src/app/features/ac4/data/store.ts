import { Injectable, computed, signal } from '@angular/core';
import { Env } from '../../../core/api';
import { monthShort } from '../../../core/format';
import { queryFactory } from '../../../core/query';
import {
  AngerHistRow, AngerRow, DimRow, JupRow, KalenderRow, KommKpiRow, KommRow, MonatRow, PlanIstRow, PtypRow, StandRow,
  StandortRow, TaetRow, TourRow, TourenRow,
} from './types';

const q = queryFactory('ac4');

/** The KPI a tile focuses: it colours the treemap and orders the Tourstandort ranking. */
export type Focus = 'plandauer_touren_h' | 'fahranteil' | 'ist_erfassung' | 'anteil_person' | 'anger_fill';
export const FOCUS_LABEL: Record<Focus, string> = {
  plandauer_touren_h: 'Plandauer Touren',
  fahranteil: 'Fahranteil',
  ist_erfassung: 'Ist-Erfassungsgrad',
  anteil_person: 'Anteil Person eingeteilt',
  anger_fill: 'Touren mit angerechneter Zeit',
};

/** A brush on the Plan-und-Ist scatter: deviation ranges in minutes. */
export interface Brush {
  beginn: [number, number];
  dauer: [number, number];
}

/** «2026-09» -> «Sep. 26» */
export function monthLabel(m: string | null | undefined): string {
  if (!m) return 'alle Monate';
  const [y, mo] = m.split('-').map(Number);
  return monthShort(new Date(y, mo - 1, 1).getTime());
}

function prevMonth(): string {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
}
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The AC-4 page state: filters, the drill path (Firma -> Tourstandort -> Tour) and the named queries. Provided
 * by Ac4Page (one per visit). Nothing here computes a business number: every figure is a _Kennzahlen measure
 * (or a measure-equivalent written in the query, backend/queries/ac4/README.md); the app picks rows and lays out.
 */
@Injectable()
export class Ac4Store {
  // ---------------------------------------------------------------- filters (all server side)
  readonly env = signal<Env>('PROD');
  /** Planmonat; default the last full month (it has Ist); null = whole planned window */
  readonly month = signal<string | null>(prevMonth());
  readonly firma = signal<string | null>(null);
  /** depot_sk of the Tourstandort */
  readonly standort = signal<string | null>(null);
  /** rank of the Personaltyp Tour in dims (resolved to the name server side) */
  readonly ptyp = signal<number | null>(null);
  /** worker_activity_sk */
  readonly taet = signal<string | null>(null);
  readonly tour = signal<string | null>(null);

  // ---------------------------------------------------------------- view state (client only)
  readonly focus = signal<Focus>('plandauer_touren_h');
  readonly brush = signal<Brush | null>(null);
  readonly jupVersion = signal<string | null>(null);

  readonly currentMonth = thisMonth();

  // ---------------------------------------------------------------- params
  private readonly envP = computed(() => ({ env: this.env() }));
  private readonly firmaP = computed(() => (this.firma() ? { firma: this.firma()! } : {}));
  private readonly standortP = computed(() => (this.standort() ? { standort: this.standort()! } : {}));
  private readonly ptypP = computed(() => (this.ptyp() != null ? { ptyp: String(this.ptyp()) } : {}));
  private readonly taetP = computed(() => (this.taet() ? { taet: this.taet()! } : {}));
  private readonly monthP = computed(() => (this.month() ? { month: this.month()! } : {}));

  // ---------------------------------------------------------------- queries
  readonly stand = q<StandRow>(() => ({ name: 'stand', params: this.envP() }));
  readonly dims = q<DimRow>(() => ({ name: 'dims', params: this.envP() }));
  readonly monate = q<MonatRow>(() => ({ name: 'monate', params: { ...this.envP(), ...this.firmaP(), ...this.standortP(), ...this.ptypP(), ...this.taetP() } }));
  readonly standorte = q<StandortRow>(() => ({ name: 'standorte', params: { ...this.envP(), ...this.monthP(), ...this.ptypP(), ...this.taetP() } }));
  readonly taetigkeiten = q<TaetRow>(() => ({ name: 'taetigkeiten', params: { ...this.envP(), ...this.monthP(), ...this.firmaP(), ...this.standortP(), ...this.ptypP() } }));
  readonly personaltypen = q<PtypRow>(() => ({ name: 'personaltypen', params: { ...this.envP(), ...this.monthP(), ...this.firmaP(), ...this.standortP(), ...this.taetP() } }));
  readonly kalender = q<KalenderRow>(() => ({ name: 'kalender', params: { ...this.envP(), ...this.firmaP(), ...this.standortP(), ...this.ptypP(), ...this.taetP() } }));
  readonly jup = q<JupRow>(() => ({ name: 'jup', params: { ...this.envP(), ...this.firmaP(), ...this.standortP(), ...this.ptypP() } }));
  readonly planIst = q<PlanIstRow>(() => ({ name: 'plan_ist', params: { ...this.envP(), ...this.monthP(), ...this.firmaP(), ...this.standortP(), ...this.ptypP(), ...this.taetP() } }));
  readonly kommKpi = q<KommKpiRow>(() => ({ name: 'kommunikation_kpi', params: { ...this.envP(), ...this.firmaP(), ...this.standortP(), ...this.ptypP() } }));
  readonly komm = q<KommRow>(() => ({ name: 'kommunikation', params: { ...this.envP(), ...this.firmaP(), ...this.standortP(), ...this.ptypP() } }));
  readonly anger = q<AngerRow>(() => ({ name: 'angerechnet', params: { ...this.envP(), ...this.firmaP(), ...this.standortP(), ...this.ptypP() } }));
  readonly angerHist = q<AngerHistRow>(() => ({ name: 'angerechnet_hist', params: { ...this.envP(), ...this.firmaP(), ...this.standortP(), ...this.ptypP() } }));
  readonly touren = q<TourenRow>(() => {
    const m = this.month();
    const s = this.standort();
    return m && s ? { name: 'touren', params: { ...this.envP(), month: m, standort: s, ...this.ptypP(), ...this.taetP() } } : null;
  });
  readonly tourQ = q<TourRow>(() => {
    const t = this.tour();
    return t ? { name: 'tour', params: { ...this.envP(), tour: t } } : null;
  });

  // ---------------------------------------------------------------- lookups (no business numbers)
  private readonly dimsBy = computed(() => {
    const m = new Map<string, DimRow>();
    for (const r of this.dims.rows()) m.set(`${r.kind}|${r.key}`, r);
    return m;
  });
  dim(kind: DimRow['kind'], key: string | null): DimRow | null {
    return key == null ? null : (this.dimsBy().get(`${kind}|${key}`) ?? null);
  }
  readonly firmen = computed(() => this.dims.rows().filter((r) => r.kind === 'firma').map((r) => r.key).sort());
  readonly monthsAll = computed(() => this.dims.rows().filter((r) => r.kind === 'monat').map((r) => r.key).sort());
  readonly ptyps = computed(() => this.dims.rows().filter((r) => r.kind === 'ptyp' && r.label).sort((a, b) => (a.rang ?? 0) - (b.rang ?? 0)));
  readonly taets = computed(() => this.dims.rows().filter((r) => r.kind === 'taet').sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', 'de')));
  ptypRank(name: string | null): number | null {
    if (!name) return null;
    return this.ptyps().find((r) => r.label === name)?.rang ?? null;
  }
  readonly standortName = computed(() => this.dim('standort', this.standort())?.label ?? null);
  readonly ptypName = computed(() => this.ptyps().find((r) => r.rang === this.ptyp())?.label ?? null);
  readonly taetName = computed(() => this.dim('taet', this.taet())?.label ?? null);

  /** A month whose data is incomplete: the first planned month when it starts mid-month, the running month
   *  and every later one (plan still open). Shown at reduced opacity / hatched, as the report convention says. */
  incomplete(m: string | null): string | null {
    if (!m) return null;
    const first = this.stand.rows()[0]?.erster_plantag?.slice(0, 10);
    if (first && m === first.slice(0, 7) && !first.endsWith('-01')) return `beginnt am ${Number(first.slice(8, 10))}.`;
    if (m === this.currentMonth) return 'laufender Monat';
    if (m > this.currentMonth) return 'Planung noch offen';
    return null;
  }

  // ---------------------------------------------------------------- actions
  setEnv(e: Env): void {
    this.env.set(e);
    this.clearAll();
  }
  pickFirma(f: string | null): void {
    this.firma.set(f);
    if (f && this.standort() && this.dim('standort', this.standort())?.parent !== f) this.standort.set(null);
    this.tour.set(null);
  }
  pickStandort(sk: string | null): void {
    this.standort.set(sk);
    if (sk) this.firma.set(this.dim('standort', sk)?.parent ?? this.firma());
    this.tour.set(null);
  }
  pickMonth(m: string | null): void {
    this.month.set(m);
    this.tour.set(null);
    this.brush.set(null);
  }
  /** Breadcrumb back one level: tour -> Tourstandort -> Firma -> all. */
  back(): void {
    if (this.tour()) this.tour.set(null);
    else if (this.standort()) this.standort.set(null);
    else if (this.firma()) this.firma.set(null);
  }
  clearAll(): void {
    this.firma.set(null);
    this.standort.set(null);
    this.ptyp.set(null);
    this.taet.set(null);
    this.tour.set(null);
    this.brush.set(null);
    this.jupVersion.set(null);
  }
}
