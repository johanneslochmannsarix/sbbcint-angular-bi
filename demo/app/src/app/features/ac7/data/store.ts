import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { ApiService, Env, MaskedPerson, Mode, QueryParams, QueryResult, Showcase, isPseudonym } from '../../../core/api';
import { createGet, queryFactory } from '../../../core/query';
import {
  ArbeitszeitRow, AuftragRow, FlussRow, GA_KEY, GA_OF_KEY, Ga, GaKey, KpiRow, ListeRow, LocationsResponse, OrtRow,
  STATUS_LABEL, StandRow, StatusCode, TaetigkeitRow,
} from './types';

const SC: Showcase = 'ac7';
const q = queryFactory(SC);

/** URL keys: the whole state lives in the query string, so breadcrumbs, browser back / forward and reloads walk it. */
const K = { env: 'env', status: 'st', ga: 'ga', taet: 't', ort: 'o', auftrag: 'a', person: 'p', jahr: 'j', drawer: 'd', view: 'ansicht', sort: 'sort' } as const;
type Key = keyof typeof K;
/** the filters, in breadcrumb order */
export const FILTERS = ['status', 'ga', 'taet', 'ort', 'auftrag', 'jahr', 'person'] as const;
export type FilterKey = (typeof FILTERS)[number];
export type Sort = 'status' | 'start' | 'dauer';
export type View = 'analyse' | 'formular';

export interface Crumb { key: FilterKey; label: string; value: string }

function viewQuery<R>(path: string, params: () => QueryParams | null) {
  const s = createGet<QueryResult<R>>(SC, () => {
    const p = params();
    return p ? { path, params: p } : null;
  }, (r) => r.rows.length === 0);
  return { ...s, rows: computed(() => s.result()?.rows ?? []) };
}

/**
 * The AC-7 page state (one per visit, provided by Ac7Page): URL-backed filters, the shared selection that links every
 * view, and the named queries. Nothing here computes a business number: counts are _Kennzahlen measures under the
 * filter set (backend/queries/ac7/README.md); the app lays out, sorts and measures stint durations on returned dates.
 */
@Injectable()
export class Ac7Store {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly qp = toSignal(this.route.queryParamMap, { requireSync: true });
  private pushes = 0;

  // ---------------------------------------------------------------- state (from the URL)
  private get(k: Key): string | null {
    return this.qp().get(K[k]);
  }
  readonly env = computed<Env>(() => (this.get('env') === 'QA' ? 'QA' : 'PROD'));
  readonly status = computed<StatusCode | null>(() => {
    const v = this.get('status');
    return v === 'AKTIV' || v === 'INAKTIV' ? v : null;
  });
  readonly ga = computed<GaKey | null>(() => {
    const v = this.get('ga');
    return v === 'AU' || v === 'DL' || v === 'AU_DL' ? v : null;
  });
  readonly taet = computed(() => intOf(this.get('taet'), 1, 50));
  readonly ort = computed(() => intOf(this.get('ort'), 1, 500));
  readonly auftrag = computed(() => {
    const v = this.get('auftrag');
    return v && /^T-[0-9a-f]{6,16}$/.test(v) ? v : null;
  });
  readonly person = computed(() => {
    const v = this.get('person');
    return isPseudonym(v) ? v : null;
  });
  readonly jahr = computed(() => intOf(this.get('jahr'), 2000, 2100));
  readonly drawer = computed(() => {
    const v = this.get('drawer');
    return isPseudonym(v) ? v : null;
  });
  readonly view = computed<View>(() => (this.get('view') === 'formular' ? 'formular' : 'analyse'));
  readonly sort = computed<Sort>(() => {
    const v = this.get('sort');
    return v === 'start' || v === 'dauer' ? v : 'status';
  });

  // ---------------------------------------------------------------- linking that does not filter
  /** a person under the pointer in the timeline or the stint chart (both highlight it) */
  readonly hover = signal<string | null>(null);

  // ---------------------------------------------------------------- params
  private readonly filterParams = computed<QueryParams>(() => {
    const p: QueryParams = { env: this.env() };
    const st = this.status();
    if (st) p['status'] = st;
    const ga = this.ga();
    if (ga) p['ga'] = ga;
    if (this.taet() != null) p['taet'] = String(this.taet());
    if (this.ort() != null) p['ort'] = String(this.ort());
    if (this.auftrag()) p['auftrag'] = this.auftrag()!;
    if (this.jahr() != null) p['jahr'] = String(this.jahr());
    if (this.person()) p['person'] = this.person()!;
    return p;
  });
  private without(...keys: string[]): QueryParams {
    const p = { ...this.filterParams() };
    for (const k of keys) delete p[k];
    return p;
  }

  // ---------------------------------------------------------------- queries
  readonly stand = q<StandRow>(() => ({ name: 'stand', params: { env: this.env() } }));
  readonly taetigkeiten = q<TaetigkeitRow>(() => ({ name: 'taetigkeiten', params: { env: this.env() } }));
  readonly auftraege = viewQuery<AuftragRow>('auftraege', () => ({ env: this.env() }));
  readonly locations = createGet<LocationsResponse>(SC, () => ({ path: 'locations', params: { env: this.env() } }),
    (r) => r.locations.length === 0);
  readonly kpi = viewQuery<KpiRow>('v/kpi', () => this.filterParams());
  readonly liste = viewQuery<ListeRow>('v/liste', () => this.filterParams());
  /** the sankey ignores its own three dimensions (it highlights the picked path instead) */
  readonly fluss = viewQuery<FlussRow>('v/fluss', () => this.without('status', 'ga', 'taet'));
  readonly arbeitszeit = viewQuery<ArbeitszeitRow>('v/arbeitszeit', () => this.filterParams());
  /** the Where view ignores its own `ort` filter (the picked location is highlighted) */
  readonly orte = viewQuery<OrtRow>('v/orte', () => this.without('ort'));

  // ---------------------------------------------------------------- lookups (no business numbers)
  readonly mode = computed<Mode>(() => this.liste.result()?.mode ?? this.api.mode() ?? 'masked');
  readonly taetByRank = computed(() => new Map(this.taetigkeiten.rows().map((r) => [r.rang, r.taetigkeit])));
  readonly rankByTaet = computed(() => new Map(this.taetigkeiten.rows().map((r) => [r.taetigkeit, r.rang])));
  readonly ortByRank = computed(() => new Map(this.orte.rows().map((r) => [r.rang, r.ort])));
  readonly rankByOrt = computed(() => new Map(this.orte.rows().map((r) => [r.ort, r.rang])));
  /** order label (token in masked mode, the name under -Real) -> its row; the token is the filter value in every mode */
  readonly auftragByLabel = computed(() => new Map(this.auftraege.rows().map((r) => [r.auftrag, r])));
  readonly auftragByToken = computed(() => new Map(this.auftraege.rows().map((r) => [r.auftrag_token, r])));
  readonly listeBy = computed(() => new Map(this.liste.rows().map((r) => [r.person_sk, r])));
  /** the person the drawer shows: from the list, even when a filter hides it later */
  private readonly drawerCache = new Map<string, ListeRow>();
  readonly drawerRow = computed<ListeRow | null>(() => {
    const k = this.drawer();
    if (!k) return null;
    const r = this.listeBy().get(k);
    if (r) this.drawerCache.set(k, r);
    return r ?? this.drawerCache.get(k) ?? null;
  });

  personOf(r: ListeRow): MaskedPerson {
    const mode = this.mode();
    if (!isPseudonym(r.person_sk)) return { key: 'P-unknown' as never, label: null, mode };
    const label = mode === 'real' ? [r.nachname, r.vorname].filter((x) => x).join(', ') || null : r.person_sk;
    return { key: r.person_sk, label, mode };
  }
  personLabel(r: ListeRow): string {
    const p = this.personOf(r);
    return p.label ?? `${p.key} (ohne Namen)`;
  }

  readonly crumbs = computed<Crumb[]>(() => {
    const out: Crumb[] = [];
    const st = this.status();
    if (st) out.push({ key: 'status', label: `Status ${STATUS_LABEL[st]}`, value: st });
    const ga = this.ga();
    if (ga) out.push({ key: 'ga', label: `Geschäftsart ${GA_OF_KEY[ga]}`, value: ga });
    const t = this.taet();
    if (t != null) out.push({ key: 'taet', label: `Tätigkeit ${this.taetByRank().get(t) ?? `#${t}`}`, value: String(t) });
    const o = this.ort();
    if (o != null) out.push({ key: 'ort', label: `Ort ${this.ortByRank().get(o) ?? `#${o}`}`, value: String(o) });
    const a = this.auftrag();
    if (a) out.push({ key: 'auftrag', label: `Auftrag ${this.auftragByToken().get(a)?.auftrag ?? a}`, value: a });
    const j = this.jahr();
    if (j != null) out.push({ key: 'jahr', label: `Austritt ${j}`, value: String(j) });
    const p = this.person();
    if (p) out.push({ key: 'person', label: `Person ${this.mode() === 'real' ? this.personLabelOf(p) : p}`, value: p });
    return out;
  });
  private personLabelOf(key: string): string {
    const r = this.listeBy().get(key);
    return r ? this.personLabel(r) : key;
  }
  readonly filtered = computed(() => this.crumbs().length > 0);

  // ---------------------------------------------------------------- actions
  private go(patch: Partial<Record<Key, string | null>>, push = true): void {
    const cur = this.qp();
    const params: Params = {};
    for (const k of Object.keys(K) as Key[]) {
      const v = k in patch ? patch[k] : cur.get(K[k]);
      if (v != null && v !== '') params[K[k]] = v;
    }
    const changed = (Object.keys(patch) as Key[]).some((k) => (patch[k] ?? null) !== (cur.get(K[k]) ?? null));
    if (!changed) return;
    if (push) this.pushes++;
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: !push });
  }
  setEnv(e: Env): void {
    // pseudonyms / tokens / ranks belong to one env: a switch starts clean
    this.go({ env: e === 'PROD' ? null : e, status: null, ga: null, taet: null, ort: null, auftrag: null, person: null, jahr: null, drawer: null });
  }
  /** set or toggle one filter (a click on the selected value clears it) */
  toggle(key: FilterKey, value: string | null): void {
    const cur = this.get(key);
    this.go(patchOf(key, value != null && value === cur ? null : value));
  }
  setStatus(s: StatusCode | null): void { this.toggle('status', s); }
  setGa(g: Ga | null): void { this.toggle('ga', g ? GA_KEY[g] : null); }
  setTaet(name: string | null): void { this.toggle('taet', name ? String(this.rankByTaet().get(name) ?? '') || null : null); }
  setOrt(name: string | null): void { this.toggle('ort', name ? String(this.rankByOrt().get(name) ?? '') || null : null); }
  /** by the label the list shows (token or -Real name) */
  setAuftrag(label: string | null): void { this.toggle('auftrag', label ? this.auftragByLabel().get(label)?.auftrag_token ?? null : null); }
  setJahr(j: number | null): void { this.toggle('jahr', j == null ? null : String(j)); }
  setPerson(p: string | null): void { this.toggle('person', p); }
  clear(key: FilterKey): void { this.go(patchOf(key, null)); }
  /** keep the crumbs up to and including `key`, drop the ones after it */
  toCrumb(key: FilterKey): void {
    const cs = this.crumbs();
    const i = cs.findIndex((c) => c.key === key);
    const patch: Partial<Record<Key, string | null>> = {};
    for (const c of cs.slice(i + 1)) patch[c.key] = null;
    this.go(patch);
  }
  resetAll(): void {
    this.go({ status: null, ga: null, taet: null, ort: null, auftrag: null, person: null, jahr: null, drawer: null });
  }
  /** one step back: browser history when this page pushed it, else drop the last crumb */
  back(): void {
    if (this.pushes > 0) {
      this.pushes--;
      this.location.back();
      return;
    }
    const cs = this.crumbs();
    if (cs.length) this.go(patchOf(cs[cs.length - 1].key, null), false);
  }
  openDrawer(p: string | null): void { this.go({ drawer: p }); }
  setView(v: View): void { this.go({ view: v === 'analyse' ? null : v }); }
  setSort(s: Sort): void { this.go({ sort: s === 'status' ? null : s }, false); }
}

function patchOf(key: FilterKey, value: string | null): Partial<Record<Key, string | null>> {
  const p: Partial<Record<Key, string | null>> = {};
  p[key] = value;
  return p;
}

function intOf(v: string | null, lo: number, hi: number): number | null {
  if (v == null || !/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
}
