import { Injectable, computed, signal } from '@angular/core';
import { Env } from '../../../core/api';
import { queryFactory } from '../../../core/query';
import {
  DiffRow, DimRow, HeatRow, HierRow, KostenRow, KpiRow, StandRow, TourRow, TourenRow, VergleichRow, WocheRow, WochenRow,
} from './types';

const q = queryFactory('ac6');

/** Settled (Filippo 2026-10-08): Zedas «JUP 5» = CargoControl «Schichtbildung 1», 07.09.–12.12.2026. */
export const S1_NAME = 'Schichtbildung 1';
export const S1_PERIOD = '07.09.–12.12.2026';
/** Settled: «2026 - CCR - Schichtbildung» is Leitstelle Rotterdam only. Every other prefix is undecoded. */
export const DECODED: Record<string, string> = {
  [S1_NAME]: `Zedas «JUP 5», Zeitraum ${S1_PERIOD}`,
  '2026 - CCR - Schichtbildung': 'nur Leitstelle Rotterdam',
};

export type HeatMeasure = 'dauer_h' | 'touren' | 'tourelemente' | 'fahren_h';
export const HEAT_LABEL: Record<HeatMeasure, string> = {
  dauer_h: 'Dauer Tourelemente',
  touren: 'Touren',
  tourelemente: 'Tourelemente',
  fahren_h: 'davon Fahren',
};

/**
 * The AC-6 page state: version, filters, the drill path (Firma -> Tourstandort -> Personaltyp -> Tätigkeit ->
 * Tour) and the named queries. Every label filter is the RANK the backend resolves to the name (dims rows carry
 * rank + label); the browser never sends a name. Provided by Ac6Page (one per visit). Nothing here computes a
 * business number: every figure is a _Kennzahlen measure or a measure-equivalent in the query (README).
 */
@Injectable()
export class Ac6Store {
  // ---------------------------------------------------------------- selection (server side)
  readonly env = signal<Env>('PROD');
  /** picked version rank; null = the default (Schichtbildung 1 by name, settled) */
  readonly versionPick = signal<number | null>(null);
  readonly comparePick = signal<number | null>(null);
  readonly firma = signal<number | null>(null);
  readonly standort = signal<number | null>(null);
  readonly ptyp = signal<number | null>(null);
  readonly taet = signal<number | null>(null);
  readonly tag = signal<number | null>(null);
  readonly tour = signal<string | null>(null);
  /** a Tourstandort NAME from a deep link (/ac6?tourstandort=…), resolved to its rank once dims are there */
  readonly pendingStandort = signal<string | null>(null);

  // ---------------------------------------------------------------- view state (client only)
  readonly heatMeasure = signal<HeatMeasure>('dauer_h');

  // ---------------------------------------------------------------- dims
  readonly stand = q<StandRow>(() => ({ name: 'stand', params: { env: this.env() } }));
  readonly dims = q<DimRow>(() => ({ name: 'dims', params: { env: this.env() } }));

  private of(kind: DimRow['kind']): DimRow[] {
    return this.dims.rows().filter((r) => r.kind === kind && r.label != null).sort((a, b) => a.rang - b.rang);
  }
  readonly versions = computed(() => this.of('version'));
  readonly firmen = computed(() => this.of('firma'));
  readonly standorte = computed(() => this.of('standort'));
  readonly ptyps = computed(() => this.of('ptyp'));
  readonly taets = computed(() => this.of('taet'));
  readonly tage = computed(() => this.of('tag'));

  label(kind: DimRow['kind'], rank: number | null): string | null {
    if (rank == null) return null;
    return this.dims.rows().find((r) => r.kind === kind && r.rang === rank)?.label ?? null;
  }
  rankOf(kind: DimRow['kind'], label: string | null | undefined): number | null {
    if (label == null) return null;
    return this.dims.rows().find((r) => r.kind === kind && r.label === label)?.rang ?? null;
  }
  dayLabel(nr: number | null | undefined): string {
    if (nr == null) return '–';
    return this.tage().find((r) => r.rang === nr)?.label ?? String(nr);
  }

  /** the version shown: picked, else Schichtbildung 1 (settled), else the one with most tours */
  readonly version = computed<number | null>(() => {
    const p = this.versionPick();
    if (p != null) return p;
    const vs = this.versions();
    return vs.find((v) => v.label === S1_NAME)?.rang ?? [...vs].sort((a, b) => (b.touren ?? 0) - (a.touren ?? 0))[0]?.rang ?? null;
  });
  readonly versionName = computed(() => this.label('version', this.version()));
  readonly versionRow = computed(() => this.versions().find((v) => v.rang === this.version()) ?? null);
  readonly isS1 = computed(() => this.versionName() === S1_NAME);

  /** Tourstandorte each version plans (dims kind vts) */
  private readonly vts = computed(() => {
    const m = new Map<number, Set<string>>();
    for (const r of this.dims.rows()) if (r.kind === 'vts' && r.label) (m.get(r.rang) ?? m.set(r.rang, new Set()).get(r.rang)!).add(r.label);
    return m;
  });
  /** versions that plan at least one Tourstandort of the shown version, the most alike Tourstandort set first
   *  (Jaccard: shared / union - a one-depot version pairs with its own family, not with a 30-depot one) */
  readonly comparable = computed(() => {
    const a = this.version();
    const mine = this.vts().get(a ?? -1) ?? new Set<string>();
    return this.versions()
      .filter((v) => v.rang !== a)
      .map((v) => {
        const theirs = this.vts().get(v.rang) ?? new Set<string>();
        const shared = [...theirs].filter((s) => mine.has(s)).length;
        return { v, shared, alike: shared / (mine.size + theirs.size - shared || 1) };
      })
      .filter((x) => x.shared > 0)
      .sort((x, y) => y.alike - x.alike || (y.v.touren ?? 0) - (x.v.touren ?? 0));
  });
  readonly compare = computed<number | null>(() => {
    const p = this.comparePick();
    const list = this.comparable();
    if (p != null && list.some((x) => x.v.rang === p)) return p;
    return list[0]?.v.rang ?? null;
  });
  readonly compareName = computed(() => this.label('version', this.compare()));
  readonly compareShared = computed(() => this.comparable().find((x) => x.v.rang === this.compare())?.shared ?? 0);

  readonly firmaName = computed(() => this.label('firma', this.firma()));
  readonly standortName = computed(() => this.label('standort', this.standort()));
  readonly ptypName = computed(() => this.label('ptyp', this.ptyp()));
  readonly taetName = computed(() => this.label('taet', this.taet()));

  // ---------------------------------------------------------------- params
  private readonly envP = computed(() => ({ env: this.env() }));
  private opt(k: string, v: number | null): Record<string, string> {
    return v == null ? {} : { [k]: String(v) };
  }
  private readonly vP = computed(() => (this.version() == null ? null : { ...this.envP(), version: String(this.version()) }));
  private readonly filterP = computed(() => ({
    ...this.opt('firma', this.firma()), ...this.opt('standort', this.standort()), ...this.opt('ptyp', this.ptyp()), ...this.opt('taet', this.taet()),
  }));

  // ---------------------------------------------------------------- queries
  readonly kpi = q<KpiRow>(() => (this.vP() ? { name: 'kpi', params: { ...this.vP()!, ...this.filterP() } } : null));
  readonly heat = q<HeatRow>(() => (this.vP()
    ? { name: 'heatmap', params: { ...this.vP()!, ...this.opt('firma', this.firma()), ...this.opt('ptyp', this.ptyp()), ...this.opt('taet', this.taet()) } }
    : null));
  readonly hier = q<HierRow>(() => (this.vP() ? { name: 'hierarchy', params: { ...this.vP()!, ...this.opt('tag', this.tag()) } } : null));
  readonly woche = q<WocheRow>(() => (this.vP() ? { name: 'woche', params: { ...this.vP()!, ...this.filterP() } } : null));
  readonly diff = q<DiffRow>(() => {
    const b = this.compare();
    return this.vP() && b != null
      ? { name: 'diff', params: { ...this.vP()!, version_b: String(b), ...this.opt('firma', this.firma()), ...this.opt('tag', this.tag()) } }
      : null;
  });
  readonly vergleich = q<VergleichRow>(() => (this.isS1()
    ? { name: 'vergleich', params: { ...this.envP(), ...this.opt('firma', this.firma()), ...this.opt('ptyp', this.ptyp()), ...this.opt('taet', this.taet()) } }
    : null));
  readonly wochen = q<WochenRow>(() => (this.isS1() ? { name: 'vergleich_wochen', params: { ...this.envP(), ...this.filterP() } } : null));
  readonly kosten = q<KostenRow>(() => ({
    name: 'kosten', params: { ...this.envP(), ...this.opt('firma', this.firma()), ...this.opt('standort', this.standort()), ...this.opt('tag', this.tag()) },
  }));
  readonly touren = q<TourenRow>(() => (this.vP() && this.standort() != null
    ? { name: 'touren', params: { ...this.vP()!, standort: String(this.standort()), ...this.opt('ptyp', this.ptyp()), ...this.opt('taet', this.taet()), ...this.opt('tag', this.tag()) } }
    : null));
  readonly tourQ = q<TourRow>(() => (this.tour() ? { name: 'tour', params: { ...this.envP(), tour: this.tour()! } } : null));

  /** a rank that no longer resolves to the label the page shows (model refreshed between dims and a query) */
  readonly drift = computed(() => {
    const k = this.kpi.rows().find((r) => r.ist_gesamt);
    if (!k) return false;
    return k.sel_version !== this.versionName() || k.sel_standort !== this.standortName() || k.sel_firma !== this.firmaName()
      || k.sel_ptyp !== this.ptypName() || k.sel_taet !== this.taetName();
  });

  // ---------------------------------------------------------------- actions
  setEnv(e: Env): void {
    this.env.set(e);
    this.versionPick.set(null);
    this.comparePick.set(null);
    this.clearAll();
  }
  pickVersion(rank: number | null): void {
    this.versionPick.set(rank);
    this.tour.set(null);
  }
  pickFirma(rank: number | null): void {
    this.firma.set(rank);
    const sName = this.standortName();
    if (rank != null && sName) {
      const parent = this.dims.rows().find((r) => r.kind === 'standort' && r.label === sName)?.parent;
      if (parent !== this.label('firma', rank)) this.standort.set(null);
    }
    this.tour.set(null);
  }
  pickStandort(rank: number | null): void {
    this.standort.set(rank);
    if (rank != null) {
      const parent = this.dims.rows().find((r) => r.kind === 'standort' && r.rang === rank)?.parent ?? null;
      const f = this.rankOf('firma', parent);
      if (f != null) this.firma.set(f);
    }
    this.tour.set(null);
  }
  pickPtyp(rank: number | null): void {
    this.ptyp.set(rank);
    this.tour.set(null);
  }
  pickTaet(rank: number | null): void {
    this.taet.set(rank);
    this.tour.set(null);
  }
  pickTag(nr: number | null): void {
    this.tag.set(nr);
    this.tour.set(null);
  }
  /** Breadcrumb back one level: tour -> Tätigkeit -> Personaltyp -> Tourstandort -> Firma -> weekday. */
  back(): void {
    if (this.tour()) this.tour.set(null);
    else if (this.taet() != null) this.taet.set(null);
    else if (this.ptyp() != null) this.ptyp.set(null);
    else if (this.standort() != null) this.standort.set(null);
    else if (this.firma() != null) this.firma.set(null);
    else if (this.tag() != null) this.tag.set(null);
  }
  readonly canBack = computed(() => !!this.tour() || [this.taet(), this.ptyp(), this.standort(), this.firma(), this.tag()].some((v) => v != null));
  clearAll(): void {
    this.firma.set(null);
    this.standort.set(null);
    this.ptyp.set(null);
    this.taet.set(null);
    this.tag.set(null);
    this.tour.set(null);
  }
}
