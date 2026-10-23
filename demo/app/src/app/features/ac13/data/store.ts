import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Env, Mode } from '../../../core/api';
import { queryFactory } from '../../../core/query';
import {
  BoxRow, DimRow, GridRow, KanteRow, MonatRow, PunktRow, RegelRow, StandRow, StandortTagRow, TourListRow, TourRow, UeRow,
} from './types';

const q = queryFactory('ac13');

/** sm_nachbereitung_cd exists in CC QA only (PROD planned Thursday 2026-10-22, datasets.py). */
export const AC13_ENVS: readonly Env[] = ['QA'];

/** What a KPI tile puts in front: the calendar's emphasis, the heatmap measure and the AZ axis follow it. */
export type Focus = 'touren' | 'offen' | 'az' | 'ue' | 'schwelle' | 'verkauft' | 'abwesend';
export type AzMeasure = 'arbeitszeit' | 'angerechnet';
export type HeatMeasure = 'touren' | 'offen';

export interface Edge {
  start: string;
  ziel: string;
}

/**
 * The AC-13 page state: month (default = the model's «Vormonat», never the browser clock), Standort and Haupttyp
 * (ranks the backend resolves; the browser never sends a label), and the drill path day / person / edge -> leg ->
 * tour. Month, Standort, Haupttyp, day and edge live in the URL, so browser back walks them; person and tour stay
 * in memory (a pseudonym and a tour key are handles of this backend process, not URL material). «‹ Zurück» walks
 * every level. Nothing here computes a business number: every figure is a measure or a measure-equivalent in the
 * query (README); the views only lay them out.
 */
@Injectable()
export class Ac13Store {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // ---------------------------------------------------------------- selection
  readonly env = signal<Env>('QA');
  readonly monthPick = signal<string | null>(null);
  readonly standort = signal<number | null>(null);
  readonly haupttyp = signal<number | null>(null);
  readonly day = signal<string | null>(null);
  readonly edge = signal<Edge | null>(null);
  readonly person = signal<string | null>(null);
  readonly leg = signal<string | null>(null);
  readonly tour = signal<string | null>(null);

  // ---------------------------------------------------------------- view state (client only)
  readonly focus = signal<Focus>('touren');
  readonly azMeasure = signal<AzMeasure>('arbeitszeit');
  readonly heatMeasure = signal<HeatMeasure>('touren');

  // ---------------------------------------------------------------- base queries
  readonly stand = q<StandRow>(() => ({ name: 'stand', params: { env: this.env() } }));
  readonly dims = q<DimRow>(() => ({ name: 'dims', params: { env: this.env() } }));

  private of(kind: DimRow['kind']): DimRow[] {
    return this.dims.rows().filter((r) => r.kind === kind && r.label != null).sort((a, b) => a.rang - b.rang || a.label!.localeCompare(b.label!));
  }
  readonly months = computed(() => this.of('monat').filter((m) => (m.touren ?? 0) > 0));
  readonly standorte = computed(() => this.of('standort'));
  readonly haupttypen = computed(() => this.of('haupttyp'));
  readonly konten = computed(() => this.of('konto'));

  readonly vormonat = computed(() => this.stand.rows()[0]?.vormonat ?? this.of('monat').find((m) => m.parent === 'Vormonat')?.label ?? null);
  readonly month = computed(() => this.monthPick() ?? this.vormonat());
  readonly isVormonat = computed(() => this.month() != null && this.month() === this.vormonat());

  label(kind: DimRow['kind'], rank: number | null): string | null {
    if (rank == null) return null;
    return this.dims.rows().find((r) => r.kind === kind && r.rang === rank)?.label ?? null;
  }
  rankOf(kind: DimRow['kind'], label: string | null | undefined): number | null {
    if (label == null) return null;
    return this.dims.rows().find((r) => r.kind === kind && r.label === label)?.rang ?? null;
  }
  readonly standortName = computed(() => this.label('standort', this.standort()));
  readonly haupttypName = computed(() => this.label('haupttyp', this.haupttyp()));

  // ---------------------------------------------------------------- params
  private opt(k: string, v: number | string | null): Record<string, string> {
    return v == null ? {} : { [k]: String(v) };
  }
  private readonly envP = computed(() => ({ env: this.env() }));
  private readonly monthP = computed(() => ({ ...this.envP(), ...this.opt('month', this.monthPick()) }));
  private readonly sP = computed(() => this.opt('standort', this.standort()));
  private readonly hP = computed(() => this.opt('haupttyp', this.haupttyp()));

  // ---------------------------------------------------------------- queries
  readonly monate = q<MonatRow>(() => ({ name: 'monate', params: { ...this.envP(), ...this.sP(), ...this.hP() } }));
  readonly standortTage = q<StandortTagRow>(() => ({ name: 'standort_tage', params: { ...this.monthP(), ...this.sP(), ...this.hP() } }));
  readonly grid = q<GridRow>(() => ({ name: 'menge_grid', params: { ...this.monthP(), ...this.sP(), ...this.hP() } }));
  readonly box = q<BoxRow>(() => ({ name: 'az_box', params: { ...this.monthP(), ...this.sP(), ...this.hP() } }));
  readonly punkte = q<PunktRow>(() => ({ name: 'az_punkte', params: { ...this.monthP(), ...this.sP(), ...this.hP() } }));
  readonly kanten = q<KanteRow>(() => ({ name: 'ue_kanten', params: { ...this.monthP(), ...this.sP() } }));
  readonly ueTouren = q<UeRow>(() => ({ name: 'ue_touren', params: { ...this.monthP(), ...this.sP() } }));
  readonly regeln = q<RegelRow>(() => ({ name: 'regeln', params: { ...this.envP(), ...this.sP() } }));
  readonly tagTouren = q<TourListRow>(() => (this.day()
    ? { name: 'tag_touren', params: { ...this.envP(), datum: this.day()!, ...this.sP(), ...this.hP() } } : null));
  readonly personTouren = q<TourListRow>(() => (this.person()
    ? { name: 'person_touren', params: { ...this.monthP(), person: this.person()! } } : null));
  readonly tourQ = q<TourRow>(() => (this.tour() ? { name: 'tour', params: { ...this.envP(), tour: this.tour()! } } : null));

  /** the backend's masking mode, for personOf() */
  readonly mode = computed<Mode>(() => this.grid.result()?.mode ?? this.ueTouren.result()?.mode ?? 'masked');
  readonly monthRow = computed(() => this.monate.rows().find((r) => r.monat === this.month()) ?? null);

  // ---------------------------------------------------------------- actions
  pickMonth(m: string | null): void {
    this.monthPick.set(m === this.vormonat() ? null : m);
    this.day.set(null);
    this.edge.set(null);
    this.person.set(null);
    this.leg.set(null);
    this.tour.set(null);
  }
  pickStandort(rank: number | null): void {
    this.standort.set(rank);
    this.edge.set(null);
    this.leg.set(null);
    this.tour.set(null);
  }
  pickHaupttyp(rank: number | null): void {
    this.haupttyp.set(rank);
    this.tour.set(null);
  }
  pickDay(iso: string | null): void {
    this.day.set(iso);
    this.tour.set(null);
  }
  pickEdge(e: Edge | null): void {
    this.edge.set(e);
    this.leg.set(null);
    this.tour.set(null);
  }
  pickPerson(p: string | null): void {
    this.person.set(p);
    this.tour.set(null);
  }
  pickLeg(sk: string | null): void {
    this.leg.set(sk);
  }
  openTour(sk: string | null): void {
    this.tour.set(sk);
  }

  /** «‹ Zurück»: tour -> leg -> edge -> person -> day -> Haupttyp -> Standort -> month (back to the Vormonat). */
  back(): void {
    if (this.tour()) this.tour.set(null);
    else if (this.leg()) this.leg.set(null);
    else if (this.edge()) this.edge.set(null);
    else if (this.person()) this.person.set(null);
    else if (this.day()) this.day.set(null);
    else if (this.haupttyp() != null) this.haupttyp.set(null);
    else if (this.standort() != null) this.standort.set(null);
    else if (this.monthPick() != null) this.monthPick.set(null);
  }
  readonly canBack = computed(() => !!(this.tour() || this.leg() || this.edge() || this.person() || this.day()
    || this.haupttyp() != null || this.standort() != null || this.monthPick() != null));
  clearAll(): void {
    this.monthPick.set(null);
    this.standort.set(null);
    this.haupttyp.set(null);
    this.day.set(null);
    this.edge.set(null);
    this.person.set(null);
    this.leg.set(null);
    this.tour.set(null);
  }

  // ---------------------------------------------------------------- URL <-> state (browser back)
  constructor() {
    const read = (m: Map<string, string | null>) => {
      const month = m.get('monat') ?? null;
      this.monthPick.set(month && /^\d{4}-\d{2}$/.test(month) ? month : null);
      const n = (k: string) => {
        const v = m.get(k);
        return v != null && /^\d{1,3}$/.test(v) ? Number(v) : null;
      };
      this.standort.set(n('standort'));
      this.haupttyp.set(n('haupttyp'));
      const d = m.get('tag') ?? null;
      this.day.set(d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
      const k = m.get('kante') ?? null;
      const parts = k ? k.split('>') : [];
      this.edge.set(parts.length === 2 && parts[0] && parts[1] ? { start: parts[0], ziel: parts[1] } : null);
    };
    this.route.queryParamMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((pm) => {
      const want = new Map(['monat', 'standort', 'haupttyp', 'tag', 'kante'].map((k) => [k, pm.get(k)]));
      if (this.urlKey(want) !== this.urlKey(this.urlState())) read(want);
    });
    effect(() => {
      const s = this.urlState();
      const now = this.route.snapshot.queryParamMap;
      const cur = new Map(['monat', 'standort', 'haupttyp', 'tag', 'kante'].map((k) => [k, now.get(k)]));
      if (this.urlKey(s) === this.urlKey(cur)) return;
      void this.router.navigate([], { relativeTo: this.route, queryParams: Object.fromEntries(s), replaceUrl: false });
    });
  }

  private readonly urlState = computed(() => new Map<string, string | null>([
    ['monat', this.monthPick()],
    ['standort', this.standort() == null ? null : String(this.standort())],
    ['haupttyp', this.haupttyp() == null ? null : String(this.haupttyp())],
    ['tag', this.day()],
    ['kante', this.edge() ? `${this.edge()!.start}>${this.edge()!.ziel}` : null],
  ]));
  private urlKey(m: Map<string, string | null>): string {
    return [...m.entries()].map(([k, v]) => `${k}=${v ?? ''}`).join('&');
  }
}
