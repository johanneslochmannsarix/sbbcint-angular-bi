import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { ENVS, Env } from '../../../core/api';
import { monthLong, monthShort } from '../../../core/format';
import { queryFactory } from '../../../core/query';
import {
  AuftragListeRow, AuftragRow, ElementRow, GaCode, KATS, KatCode, KpiRow, MonatRow, PersonRow, PunktRow, QuoteRow,
  StandRow, TagRow, TourRow,
} from './types';

const q = queryFactory('ac9');

const MONTH_RE = /^\d{4}-\d{2}$/;
const TOKEN_RE = /^T-[0-9a-f]{6,16}$/;
const TOUR_RE = /^D-[0-9a-f]{10}$/;
const PERSON_RE = /^P-[0-9a-f]{6,16}$/;

/** «2026-09» -> «Sep. 26» / «September 2026» */
export function monthLabel(m: string | null | undefined, long = false): string {
  if (!m || !MONTH_RE.test(m)) return '–';
  const [y, mo] = m.split('-').map(Number);
  const t = new Date(y, mo - 1, 1).getTime();
  return long ? monthLong(t) : monthShort(t);
}
export function rangeLabel(von: string | null, bis: string | null, long = false): string {
  if (!von || !bis) return 'alle Monate';
  return von === bis ? monthLabel(von, long) : `${monthLabel(von, long)} – ${monthLabel(bis, long)}`;
}
export function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The AC-9 page state. **The URL is the state**: env, months (von / bis), Geschäftsart, order category and the
 * drill path order -> tour -> person live in the query string, so the browser's back button walks the drill
 * back, every view is a deep link (/ac9?auftrag=T-… from AC-7), and a reload keeps the place. The handles in the
 * URL are tokens / pseudo-ids only. Nothing here computes a business number: every figure is a model measure
 * (backend/queries/ac9/README.md); the store only chooses rows and the default month.
 */
@Injectable()
export class Ac9Store {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly qp = toSignal(this.route.queryParamMap, { requireSync: true });

  // ---------------------------------------------------------------- state from the URL (validated)
  readonly env = computed<Env>(() => (ENVS as readonly string[]).includes(this.qp().get('env') ?? '') ? (this.qp().get('env') as Env) : 'PROD');
  private readonly vonUrl = computed(() => this.pick('von', MONTH_RE));
  private readonly bisUrl = computed(() => this.pick('bis', MONTH_RE));
  readonly ga = computed<GaCode | null>(() => (['AUE', 'DL'].includes(this.qp().get('ga') ?? '') ? (this.qp().get('ga') as GaCode) : null));
  readonly kat = computed<KatCode | null>(() => (KATS.some((k) => k.code === this.qp().get('kat')) ? (this.qp().get('kat') as KatCode) : null));
  /** the order handle: its token T-… in every mode (the label is the name only under -Real) */
  readonly auftrag = computed(() => this.pick('auftrag', TOKEN_RE));
  readonly tour = computed(() => this.pick('tour', TOUR_RE));
  readonly person = computed(() => this.pick('person', PERSON_RE));

  private pick(key: string, re: RegExp): string | null {
    const v = this.qp().get(key);
    return v && re.test(v) ? v : null;
  }

  // ---------------------------------------------------------------- the month range (URL or the default)
  readonly currentMonth = thisMonth();
  /**
   * Default when the URL has none: the latest IST month before the running calendar month whose tours reach half
   * the busiest month (layout rule, README). PROD 2026-09; QA 2026-06 (QA's batch ends 2026-09-02).
   */
  readonly defaultMonth = computed<string | null>(() => {
    const tot = this.monate.rows().filter((r) => r.ga_total);
    if (!tot.length) return null;
    const top = Math.max(...tot.map((r) => r.touren));
    const ok = tot.filter((r) => r.touren >= top / 2 && r.year_month_ist < this.currentMonth).map((r) => r.year_month_ist);
    return ok.length ? ok.sort().at(-1)! : tot.map((r) => r.year_month_ist).sort().at(-1)!;
  });
  /** '' in the URL = all months on purpose */
  readonly allMonths = computed(() => this.qp().get('von') === '');
  readonly von = computed(() => (this.allMonths() ? null : this.vonUrl() ?? this.defaultMonth()));
  readonly bis = computed(() => (this.allMonths() ? null : this.bisUrl() ?? this.vonUrl() ?? this.defaultMonth()));
  /** range-dependent queries wait until the default month is known, so they load once, not twice */
  readonly rangeReady = computed(() => this.allMonths() || !!this.vonUrl() || this.defaultMonth() !== null);
  readonly months = computed(() => this.monate.rows().filter((r) => r.ga_total).map((r) => r.year_month_ist).sort());

  // ---------------------------------------------------------------- params
  private readonly envP = computed(() => ({ env: this.env() }));
  private readonly rangeP = computed(() => (this.von() && this.bis() ? { von: this.von()!, bis: this.bis()! } : {}));
  private readonly filterP = computed(() => ({
    ...(this.ga() ? { ga: this.ga()! } : {}),
    ...(this.kat() ? { kat: this.kat()! } : {}),
  }));
  private readonly auftragP = computed(() => (this.auftrag() ? { auftrag: this.auftrag()! } : {}));

  // ---------------------------------------------------------------- queries
  readonly stand = q<StandRow>(() => ({ name: 'stand', params: this.envP() }));
  readonly monate = q<MonatRow>(() => ({ name: 'monate', params: { ...this.envP(), ...this.filterP(), ...this.auftragP() } }));
  readonly kpi = q<KpiRow>(() => (this.rangeReady() ? { name: 'kpi', params: { ...this.envP(), ...this.rangeP(), ...this.filterP(), ...this.auftragP() } } : null));
  readonly quote = q<QuoteRow>(() => ({ name: 'quote', params: { ...this.envP(), ...this.filterP(), ...this.auftragP() } }));
  readonly auftragListe = q<AuftragListeRow>(() => ({ name: 'auftrag_liste', params: this.envP() }));
  readonly auftraege = q<AuftragRow>(() => (this.rangeReady() ? { name: 'auftraege', params: { ...this.envP(), ...this.rangeP(), ...this.filterP() } } : null));
  readonly punkte = q<PunktRow>(() => (this.rangeReady() ? { name: 'punkte', params: { ...this.envP(), ...this.rangeP(), ...this.filterP(), ...this.auftragP() } } : null));
  readonly tage = q<TagRow>(() => (this.auftrag() ? { name: 'auftrag_tage', params: { ...this.envP(), ...this.auftragP() } } : null));
  readonly touren = q<TourRow>(() => (this.auftrag() && this.rangeReady() ? { name: 'touren', params: { ...this.envP(), ...this.rangeP(), ...this.auftragP() } } : null));
  readonly tourKopf = q<TourRow>(() => (this.tour() ? { name: 'tour_kopf', params: { ...this.envP(), tour: this.tour()! } } : null));
  readonly elemente = q<ElementRow>(() => (this.tour() ? { name: 'tour', params: { ...this.envP(), tour: this.tour()! } } : null));
  readonly personQ = q<PersonRow>(() => (this.person() ? { name: 'person', params: { ...this.envP(), person: this.person()! } } : null));

  // ---------------------------------------------------------------- lookups (no business numbers)
  readonly kpiTotal = computed(() => this.kpi.rows().find((r) => r.ga_total) ?? null);
  readonly kpiGa = computed(() => this.kpi.rows().filter((r) => !r.ga_total));
  readonly order = computed(() => {
    const a = this.auftrag();
    return a ? (this.auftragListe.rows().find((r) => r.auftrag_token === a) ?? null) : null;
  });
  /** the order's label (token masked, name under -Real) */
  readonly orderLabel = computed(() => this.order()?.dor_name ?? this.auftrag());
  private readonly tokenByLabel = computed(() => new Map(this.auftragListe.rows().map((r) => [r.dor_name, r.auftrag_token])));
  /** a label as other queries return it (dor_name) -> the order token */
  tokenOf(label: string | null | undefined): string | null {
    return label ? (this.tokenByLabel().get(label) ?? null) : null;
  }
  /** the DAX echoes the order it resolved; a model refresh between the list and a filter would show here */
  readonly echoMismatch = computed(() => {
    const a = this.auftrag();
    const rows = this.monate.rows();
    const label = this.orderLabel();
    return !!a && !!label && !this.monate.loading() && rows.length > 0 && rows.some((r) => r.auftrag_echo !== label);
  });
  readonly running = (m: string | null | undefined) => !!m && m >= this.currentMonth;
  readonly rangeText = computed(() => rangeLabel(this.von(), this.bis()));
  readonly rangeTextLong = computed(() => rangeLabel(this.von(), this.bis(), true));
  readonly inRange = (m: string) => !this.von() || (m >= this.von()! && m <= this.bis()!);

  // ---------------------------------------------------------------- actions (URL navigation = history entries)
  private go(p: Params, replace = false): void {
    // the default month is computed from the (filtered) month list: freeze it into the URL on the first action,
    // so a filter never moves the month under the reader
    const frozen = !('von' in p) && !this.vonUrl() && !this.allMonths() && this.von() ? { von: this.von(), bis: this.bis() } : {};
    void this.router.navigate([], { relativeTo: this.route, queryParams: { ...frozen, ...p }, queryParamsHandling: 'merge', replaceUrl: replace });
  }
  setEnv(e: Env): void {
    this.go({ env: e, auftrag: null, tour: null, person: null });
  }
  /** a click picks one month; with shift it extends the range from the current start; again on it = all */
  pickMonth(m: string | null, extend = false): void {
    if (m === null) return this.go({ von: '', bis: null, tour: null });
    if (extend && this.von()) {
      const a = this.von()! < m ? this.von()! : m;
      const b = this.von()! < m ? m : this.bis()!;
      return this.go({ von: a, bis: b > a ? b : a, tour: null });
    }
    if (this.von() === m && this.bis() === m) return this.go({ von: '', bis: null, tour: null });
    this.go({ von: m, bis: m, tour: null });
  }
  setRange(von: string, bis: string): void {
    this.go({ von, bis, tour: null });
  }
  setGa(g: GaCode | null): void {
    this.go({ ga: this.ga() === g ? null : g, tour: null });
  }
  setKat(k: KatCode | null): void {
    this.go({ kat: this.kat() === k ? null : k, tour: null });
  }
  openAuftrag(token: string | null): void {
    this.go({ auftrag: token, tour: null, person: null });
  }
  openTour(pid: string): void {
    this.go({ tour: pid, person: null });
  }
  openPerson(p: string): void {
    this.go({ person: p });
  }
  /** breadcrumb back one level: person -> tour -> order -> portfolio */
  back(): void {
    if (this.person()) this.go({ person: null });
    else if (this.tour()) this.go({ tour: null });
    else if (this.auftrag()) this.go({ auftrag: null });
  }
  clearAll(): void {
    this.go({ ga: null, kat: null, auftrag: null, tour: null, person: null });
  }
  /**
   * The shared story mode's entry point (story/story.ts, AC-9 steps): the whole page state in one navigation, no
   * filter left over from the reader. `month` null = the default month (not frozen into the URL).
   */
  storyFocus(env: Env, month: string | null, auftrag: string | null = null, tour: string | null = null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { env, von: month, bis: month, ga: null, kat: null, auftrag, tour, person: null },
      queryParamsHandling: 'merge',
    });
  }
  readonly envs = ENVS;
}
