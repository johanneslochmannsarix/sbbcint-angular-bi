import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { Env, QueryParams, Tenant } from '../../../core/api';
import { MAX_WINDOW_DAYS, WindowSel } from '../../../core/filters';
import { addDays, isoDay, today } from '../../../core/format';

export { MAX_WINDOW_DAYS };
export type { WindowSel };

/** What a page's queries allow (backend/queries/metrics/README.md, per-query param rules). Lives in route data. */
export interface PageRules {
  title: string;
  /** false = the page's queries need exactly one tenant */
  tenantAll: boolean;
  /** false = the page's queries need exactly one environment */
  envAll: boolean;
  /** the README default window for the page */
  defaultDays: number;
  /** shown in the header when a single selection is forced */
  why?: string;
}

const FALLBACK_RULES: PageRules = { title: '', tenantAll: true, envAll: true, defaultDays: 30 };

function deepestData(snap: ActivatedRouteSnapshot): PageRules | undefined {
  let s: ActivatedRouteSnapshot | null = snap;
  let rules: PageRules | undefined;
  while (s) {
    rules = (s.data['rules'] as PageRules | undefined) ?? rules;
    s = s.firstChild;
  }
  return rules;
}

/**
 * The /metrics filter state. Not the core FiltersService: these pages also allow "all tenants / all envs"
 * (an empty report slicer), which the other showcases never send, and each page forces a single value
 * where its measures need one (route data `rules`). No request is issued here.
 */
@Injectable({ providedIn: 'root' })
export class MetricsFilters {
  private readonly router = inject(Router);

  readonly rules = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => deepestData(this.router.routerState.snapshot.root) ?? FALLBACK_RULES),
    ),
    { initialValue: deepestData(this.router.routerState.snapshot.root) ?? FALLBACK_RULES },
  );

  /** The user's choice; 'ALL' may be overridden by a page that needs a single value. */
  readonly tenantChoice = signal<Tenant | 'ALL'>('ALL');
  readonly envChoice = signal<Env | 'ALL'>('PROD');
  private readonly lastTenant = signal<Tenant>('RTS');
  private readonly lastEnv = signal<Env>('PROD');
  readonly window = signal<WindowSel>({ kind: 'default' });

  /** Effective tenant for the current page; null = all tenants (no filter). */
  readonly tenant = computed<Tenant | null>(() => {
    const c = this.tenantChoice();
    if (c !== 'ALL') return c;
    return this.rules().tenantAll ? null : this.lastTenant();
  });
  readonly env = computed<Env | null>(() => {
    const c = this.envChoice();
    if (c !== 'ALL') return c;
    return this.rules().envAll ? null : this.lastEnv();
  });

  readonly dates = computed(() => {
    const w = this.window();
    if (w.kind === 'custom') return { from: w.from, to: w.to };
    const days = w.kind === 'days' ? w.days : this.rules().defaultDays;
    const t = today();
    return { from: isoDay(addDays(t, -days)), to: isoDay(t) };
  });

  readonly windowDays = computed(() => {
    const d = this.dates();
    return Math.round((Date.parse(d.to) - Date.parse(d.from)) / 86_400_000);
  });

  setTenant(t: Tenant | 'ALL'): void {
    this.tenantChoice.set(t);
    if (t !== 'ALL') this.lastTenant.set(t);
  }
  setEnv(e: Env | 'ALL'): void {
    this.envChoice.set(e);
    if (e !== 'ALL') this.lastEnv.set(e);
  }

  /** Params for a query; pass which of env/tenant the query declares. No client-side window cap: the
   *  backend is the validator, and its 400 message is what the chart shows. */
  params(opts: { env?: boolean; tenant?: boolean; dates?: boolean } = { env: true, tenant: true, dates: true }): QueryParams {
    const p: QueryParams = {};
    if (opts.env && this.env()) p['env'] = this.env()!;
    if (opts.tenant && this.tenant()) p['tenant'] = this.tenant()!;
    if (opts.dates) {
      const d = this.dates();
      p['date_from'] = d.from;
      p['date_to'] = d.to;
    }
    return p;
  }
}
