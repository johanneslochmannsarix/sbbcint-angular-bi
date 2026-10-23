import { DestroyRef, Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, Subject, catchError, map, merge, switchMap, tap } from 'rxjs';
import { ApiError, ApiService, QueryParams, QueryResult, Showcase } from './api';

export interface QueryRequest {
  showcase: Showcase;
  name: string;
  params: QueryParams;
}

/** The state every request exposes (named query or a showcase's own GET route); what app-card reads. */
export interface LoadState<T> {
  /** Last successful result. Kept while a new request loads, so a panel never flashes empty. */
  readonly result: Signal<T | null>;
  readonly error: Signal<ApiError | null>;
  readonly loading: Signal<boolean>;
  /** Loading while an older result is still on screen. */
  readonly stale: Signal<boolean>;
  /** A result arrived and it holds no rows. Not the same as "no data": it is "no rows under this filter". */
  readonly empty: Signal<boolean>;
  /** The request is switched off (e.g. nothing picked yet). */
  readonly idle: Signal<boolean>;
  retry(): void;
}

export interface QueryState<R> extends LoadState<QueryResult<R>> {
  readonly rows: Signal<R[]>;
}

/** A showcase's own GET route (e.g. /api/ac1/day_tags): same state shape, typed response. */
export interface GetRequest {
  path: string;
  params: QueryParams;
}

function sameRequest(a: QueryRequest | null, b: QueryRequest | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.showcase !== b.showcase || a.name !== b.name) return false;
  const ka = Object.keys(a.params).filter((k) => a.params[k] != null).sort();
  const kb = Object.keys(b.params).filter((k) => b.params[k] != null).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a.params[k] === b.params[k]);
}

/**
 * One named query bound to a reactive request. Call in an injection context (a field initializer).
 * A new request cancels the one in flight (switchMap); there is no polling and no timer: a request is
 * issued only when its inputs change or when retry() is called.
 */
export function createQuery<R>(request: () => QueryRequest | null): QueryState<R> {
  const api = inject(ApiService);
  const s = createLoad<QueryRequest, QueryResult<R>>(request, sameRequest, (r) => api.query<R>(r.showcase, r.name, r.params),
    (res) => res.rows.length === 0);
  return { ...s, rows: computed(() => s.result()?.rows ?? []) };
}

/**
 * A showcase's own GET route outside /q/{name} (core request ac1 #1, D2 2026-10-21), with createQuery's state
 * shape and semantics (switchMap, no polling). `isEmpty` decides what «empty» means for that response;
 * without it a result is never empty.
 */
export function createGet<T>(showcase: Showcase, request: () => GetRequest | null, isEmpty?: (res: T) => boolean): LoadState<T> {
  const api = inject(ApiService);
  return createLoad<GetRequest, T>(request, sameGet, (r) => api.get<T>(showcase, r.path, r.params), isEmpty ?? (() => false));
}

function sameGet(a: GetRequest | null, b: GetRequest | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.path !== b.path) return false;
  return sameRequest({ showcase: 'ac1', name: '', params: a.params }, { showcase: 'ac1', name: '', params: b.params });
}

function createLoad<Q, T>(request: () => Q | null, equal: (a: Q | null, b: Q | null) => boolean,
                          fetch: (r: Q) => Observable<T>, isEmpty: (res: T) => boolean): LoadState<T> {
  const destroyRef = inject(DestroyRef);
  const req = computed(request, { equal });
  const result = signal<T | null>(null);
  const error = signal<ApiError | null>(null);
  const loading = signal(false);
  const retry$ = new Subject<void>();

  merge(toObservable(req), retry$.pipe(map(() => req())))
    .pipe(
      switchMap((r) => {
        if (!r) {
          loading.set(false);
          error.set(null);
          result.set(null);
          return EMPTY;
        }
        loading.set(true);
        error.set(null);
        return fetch(r).pipe(
          tap((res) => {
            result.set(res);
            loading.set(false);
          }),
          catchError((e: ApiError) => {
            error.set(e);
            loading.set(false);
            return EMPTY;
          }),
        );
      }),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe();

  return {
    result,
    error,
    loading,
    stale: computed(() => loading() && result() !== null),
    empty: computed(() => !loading() && !error() && result() !== null && isEmpty(result()!)),
    idle: computed(() => req() === null),
    retry: () => retry$.next(),
  };
}

/** A createQuery bound to one showcase, so feature code writes { name, params } only. */
export function queryFactory(showcase: Showcase) {
  return <R>(request: () => { name: string; params: QueryParams } | null): QueryState<R> =>
    createQuery<R>(() => {
      const r = request();
      return r ? { showcase, ...r } : null;
    });
}
