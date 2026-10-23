import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { Env } from '../../../core/api';
import { addDays, dayMs, isoDay, today } from '../../../core/format';
import { queryFactory } from '../../../core/query';
import {
  DepotTagRow, ElementRow, FensterRow, JetztRow, PersonaltypRow, PositionRow, ScopeArt, ScopeRow, StandRow, StrukturRow, TageRow, Zwingend,
} from './types';

const q = queryFactory('ac10');

/** URL keys: the state lives in the query string, so browser back / forward walk the drill path. */
const K = { env: 'env', von: 'von', bis: 'bis', mandant: 'm', depot: 'd', haupttyp: 'h', kategorie: 'k', zwingend: 'z', tag: 'tag', pos: 'pos' } as const;
type Key = keyof typeof K;
/** Drill levels: a change here is a new history entry; everything else replaces the current one. */
const DRILL: readonly Key[] = ['mandant', 'depot', 'tag', 'pos'];

export const DEFAULT_BACK = 3;
export const DEFAULT_AHEAD = 7;

export interface Crumb {
  level: 'alle' | 'mandant' | 'depot' | 'tag' | 'pos';
  label: string;
}

function monday(ms: number): number {
  return addDays(ms, -((new Date(ms).getDay() + 6) % 7));
}

/**
 * AC-10 page state. Filters and the drill path are URL query params (one source of truth, back always works);
 * labels travel in the URL, ordinals (scope) travel to the backend. Nothing here computes a business number:
 * every count is a _Kennzahlen measure (backend/queries/ac10/README.md).
 */
@Injectable()
export class Ac10Store {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly qp = toSignal(this.route.queryParamMap, { requireSync: true });
  private pushes = 0;

  // ---------------------------------------------------------------- state (from the URL)
  private p(k: Key): string | null {
    const v = this.qp().get(K[k]);
    return v == null || v === '' ? null : v;
  }
  readonly today = isoDay(today());
  readonly env = computed<Env>(() => (this.p('env') === 'QA' ? 'QA' : 'PROD'));
  readonly from = computed(() => validDay(this.p('von')) ?? isoDay(addDays(today(), -DEFAULT_BACK)));
  readonly to = computed(() => {
    const t = validDay(this.p('bis')) ?? isoDay(addDays(today(), DEFAULT_AHEAD));
    return t < this.from() ? this.from() : t;
  });
  readonly mandant = computed(() => this.p('mandant'));
  readonly depot = computed(() => this.p('depot'));
  readonly haupttyp = computed(() => this.p('haupttyp'));
  readonly kategorie = computed(() => this.p('kategorie'));
  readonly zwingend = computed<Zwingend>(() => {
    const z = this.p('zwingend');
    return z === 'zwingend' || z === 'nicht' ? z : 'alle';
  });
  /** the drilled day; null = today is shown, but not «picked» */
  readonly tag = computed(() => validDay(this.p('tag')));
  readonly drillDay = computed(() => this.tag() ?? this.today);
  readonly position = computed(() => {
    const v = this.p('pos');
    return v && /^[0-9a-f]{64}$/.test(v) ? v : null;
  });
  readonly isDefaultWindow = computed(() => this.p('von') == null && this.p('bis') == null);

  // ---------------------------------------------------------------- base queries
  private readonly base = computed(() => ({ env: this.env() }));
  readonly stand = q<StandRow>(() => ({ name: 'stand', params: this.base() }));
  readonly scope = q<ScopeRow>(() => ({ name: 'scope', params: this.base() }));

  /** label -> ordinal per kind; undefined while scope loads, null when the label is not in this env's model */
  private ix(art: ScopeArt, label: string | null, mandant?: string | null): number | null | undefined {
    if (!label) return null;
    const rows = this.scope.rows();
    if (!this.scope.result()) return undefined;
    const hit = rows.find((r) => r.art === art && r.label === label && (mandant == null || r.mandant === mandant))
      ?? rows.find((r) => r.art === art && r.label === label);
    return hit ? hit.ix : null;
  }
  /** a URL label this env's model does not know (e.g. picked in PROD, then switched to QA) */
  readonly unknownLabels = computed(() => {
    const out: string[] = [];
    for (const [art, v] of [['mandant', this.mandant()], ['depot', this.depot()], ['haupttyp', this.haupttyp()], ['kategorie', this.kategorie()]] as const) {
      if (v && this.ix(art, v, art === 'depot' ? this.mandant() : null) === null) out.push(v);
    }
    return out;
  });

  /** filter params, or null while an ordinal cannot be resolved yet (requests wait for scope) */
  private readonly filters = computed(() => {
    const m = this.ix('mandant', this.mandant());
    const d = this.ix('depot', this.depot(), this.mandant());
    const h = this.ix('haupttyp', this.haupttyp());
    const k = this.ix('kategorie', this.kategorie());
    if ([m, d, h, k].some((x) => x === undefined)) return null;
    const s = (x: number | null | undefined) => (x == null ? undefined : String(x));
    return { mandant: s(m), depot: s(d), haupttyp: s(h), kategorie: s(k), zwingend: this.zwingend() === 'alle' ? undefined : this.zwingend() };
  });
  private readonly win = computed(() => ({ env: this.env(), date_from: this.from(), date_to: this.to() }));
  private with<T>(name: string, build: (f: NonNullable<ReturnType<Ac10Store['filters']>>) => Record<string, string | undefined>) {
    return () => {
      const f = this.filters();
      return f ? { name, params: build(f) } : null;
    };
  }

  // ---------------------------------------------------------------- view queries
  readonly jetzt = q<JetztRow>(this.with('jetzt', (f) => ({ env: this.env(), heute: this.today, mandant: f.mandant, depot: f.depot, haupttyp: f.haupttyp, zwingend: f.zwingend, kategorie: f.kategorie })));
  readonly fenster = q<FensterRow>(this.with('fenster', (f) => ({ ...this.win(), ...f })));
  readonly tage = q<TageRow>(this.with('tage', (f) => ({ ...this.win(), ...f })));
  /** the whole Gold window, for the mini timeline */
  readonly timeline = q<TageRow>(() => {
    const s = this.stand.rows()[0];
    const f = this.filters();
    if (!s?.fenster_von || !s.fenster_bis || !f) return null;
    return { name: 'tage', params: { env: this.env(), date_from: s.fenster_von.slice(0, 10), date_to: s.fenster_bis.slice(0, 10), ...f } };
  });
  readonly depotTage = q<DepotTagRow>(this.with('depot_tage', (f) => ({ ...this.win(), mandant: f.mandant, haupttyp: f.haupttyp, zwingend: f.zwingend })));
  readonly struktur = q<StrukturRow>(this.with('struktur', (f) => ({ ...this.win(), haupttyp: f.haupttyp, zwingend: f.zwingend })));
  readonly personaltypen = q<PersonaltypRow>(this.with('personaltypen', (f) => ({ ...this.win(), mandant: f.mandant, depot: f.depot, zwingend: f.zwingend })));
  readonly elemente = q<ElementRow>(this.with('elemente', (f) => ({ ...this.win(), kategorie: f.kategorie })));
  readonly tagSchichten = q<PositionRow>(this.with('tag', (f) => ({
    env: this.env(), tag: this.drillDay(), tier: 'schicht', mandant: f.mandant, depot: f.depot, haupttyp: f.haupttyp, zwingend: f.zwingend,
  })));
  readonly tagElemente = q<PositionRow>(this.with('tag', (f) => ({ env: this.env(), tag: this.drillDay(), tier: 'element', kategorie: f.kategorie })));

  // ---------------------------------------------------------------- derived lookups (no business numbers)
  readonly scopeOf = computed(() => {
    const by: Record<ScopeArt, ScopeRow[]> = { mandant: [], depot: [], haupttyp: [], kategorie: [] };
    for (const r of this.scope.rows()) by[r.art].push(r);
    return by;
  });
  /** the window's filter labels as the model resolved them (fenster *_gewaehlt): a mismatch means scope is stale */
  readonly labelMismatch = computed(() => {
    const f = this.fenster.rows()[0];
    if (!f || this.fenster.loading()) return false;
    const pairs: [string | null, string | null][] = [[this.mandant(), f.mandant_gewaehlt], [this.haupttyp(), f.haupttyp_gewaehlt], [this.kategorie(), f.kategorie_gewaehlt]];
    if (this.depot()) pairs.push([this.depot(), f.depot_gewaehlt]);
    return pairs.some(([want, got]) => want != null && got != null && got !== want);
  });
  readonly days = computed(() => {
    const out: string[] = [];
    for (let m = dayMs(this.from())!; m <= dayMs(this.to())!; m = addDays(m, 1)) out.push(isoDay(m));
    return out;
  });
  readonly crumbs = computed<Crumb[]>(() => {
    const c: Crumb[] = [{ level: 'alle', label: 'Alle Mandanten' }];
    if (this.mandant()) c.push({ level: 'mandant', label: this.mandant()! });
    if (this.depot()) c.push({ level: 'depot', label: this.depot()! });
    if (this.tag()) c.push({ level: 'tag', label: this.tag()! });
    if (this.position()) c.push({ level: 'pos', label: `S-${this.position()!.slice(0, 8)}` });
    return c;
  });

  // ---------------------------------------------------------------- actions
  private go(patch: Partial<Record<Key, string | null>>): void {
    const cur = this.qp();
    const params: Params = {};
    for (const k of Object.keys(K) as Key[]) {
      const v = k in patch ? patch[k] : cur.get(K[k]);
      if (v != null && v !== '') params[K[k]] = v;
    }
    const drill = DRILL.some((k) => k in patch && (patch[k] ?? null) !== (cur.get(K[k]) ?? null));
    if (drill) this.pushes++;
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: !drill });
  }
  setEnv(e: Env): void {
    this.go({ env: e === 'PROD' ? null : e, pos: null });
  }
  setWindow(from: string, to: string): void {
    const def = from === isoDay(addDays(today(), -DEFAULT_BACK)) && to === isoDay(addDays(today(), DEFAULT_AHEAD));
    this.go({ von: def ? null : from, bis: def ? null : to });
  }
  preset(kind: 'standard' | 'woche' | 'naechste' | 'vier' | 'alles'): void {
    const t = today();
    const m = monday(t);
    const s = this.stand.rows()[0];
    if (kind === 'standard') this.setWindow(isoDay(addDays(t, -DEFAULT_BACK)), isoDay(addDays(t, DEFAULT_AHEAD)));
    else if (kind === 'woche') this.setWindow(isoDay(m), isoDay(addDays(m, 6)));
    else if (kind === 'naechste') this.setWindow(isoDay(addDays(m, 7)), isoDay(addDays(m, 13)));
    else if (kind === 'vier') this.setWindow(isoDay(t), isoDay(addDays(t, 27)));
    else if (s?.fenster_von && s.fenster_bis) this.setWindow(s.fenster_von.slice(0, 10), s.fenster_bis.slice(0, 10));
  }
  setZwingend(z: Zwingend): void {
    this.go({ zwingend: z === 'alle' ? null : z, pos: null });
  }
  setHaupttyp(h: string | null): void {
    this.go({ haupttyp: h, pos: null });
  }
  setKategorie(k: string | null): void {
    this.go({ kategorie: k, pos: null });
  }
  pickMandant(m: string | null): void {
    this.go({ mandant: m, depot: null, pos: null });
  }
  pickDepot(mandant: string, depot: string): void {
    this.go({ mandant, depot, pos: null });
  }
  pickCell(mandant: string, depot: string, day: string): void {
    this.go({ mandant, depot, tag: day, pos: null });
  }
  pickDay(day: string | null): void {
    this.go({ tag: day, pos: null });
  }
  pickPosition(sk: string | null): void {
    this.go({ pos: sk });
  }
  toCrumb(level: Crumb['level']): void {
    const order: Crumb['level'][] = ['alle', 'mandant', 'depot', 'tag', 'pos'];
    const keep = order.indexOf(level);
    const patch: Partial<Record<Key, null>> = {};
    if (keep < 1) patch.mandant = null;
    if (keep < 2) patch.depot = null;
    if (keep < 3) patch.tag = null;
    if (keep < 4) patch.pos = null;
    this.go(patch);
  }
  /** one drill level up: browser history when this page pushed it, else drop the deepest level */
  back(): void {
    if (this.pushes > 0) {
      this.pushes--;
      this.location.back();
      return;
    }
    const c = this.crumbs();
    if (c.length > 1) this.toCrumb(c[c.length - 2].level);
  }
  /** shared story mode: env, window and Mandant / Depot in ONE navigation (two go() calls in a row would each
   *  start from the same old URL and the second would drop the first); clears the other filters and the drill */
  storyFocus(env: Env, from: string, to: string, mandant: string | null, depot: string | null): void {
    this.go({ env: env === 'PROD' ? null : env, von: from, bis: to, mandant, depot, haupttyp: null, kategorie: null, zwingend: null, tag: null, pos: null });
  }
  resetAll(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: this.env() === 'QA' ? { env: 'QA' } : {}, replaceUrl: false });
    this.pushes++;
  }
}

function validDay(v: string | null): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && dayMs(v) != null ? v : null;
}

export function isoWeek(ms: number): number {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
}
