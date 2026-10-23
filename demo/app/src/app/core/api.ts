import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, tap, throwError } from 'rxjs';

export type Showcase = 'ac1' | 'ac2' | 'ac8' | 'metrics' | 'ac4' | 'ac10' | 'ac6' | 'ac7' | 'ac9' | 'ac13';
export type Tenant = 'CARGOCONTROL' | 'RTS';
export type Env = 'PROD' | 'QA';
export const TENANTS: readonly Tenant[] = ['CARGOCONTROL', 'RTS'];
export const ENVS: readonly Env[] = ['PROD', 'QA'];
export const TENANT_LABEL: Record<Tenant, string> = { CARGOCONTROL: 'CargoControl', RTS: 'RT&S' };

/** Column roles as declared in the backend's <name>.roles.json (backend/app/core/masking.py). */
export type Role =
  | 'id' | 'code' | 'measure' | 'date'
  | 'label_person' | 'label_freetext' | 'label_org' | 'label_qualification' | 'label_location' | 'label_technical';
export type Mode = 'masked' | 'real';

/** Query-string values the backend whitelists per query (GET /api/<showcase>/queries lists them). */
export type QueryParams = Partial<Record<string, string>>;

export interface QueryResult<R> {
  showcase: Showcase;
  name: string;
  id: string;
  dataset: string;
  tenant: Tenant | null;
  env: Env | null;
  params: Record<string, string>;
  columns: string[];
  roles: Record<string, Role>;
  /** label_person columns that hold the person handle (always a pseudonym, in every mode) */
  person_keys: string[];
  mode: Mode;
  rows: R[];
  row_count: number;
  elapsed_ms: number;
  fetched_at: string;
  warnings: string[];
  cached: boolean;
}

export interface ApiError {
  status: number;
  message: string;
  retryAfterS?: number;
}

export interface Health {
  real: boolean;
  mode: Mode;
  started_at: string;
  limit_per_minute: number;
  calls_last_minute: number;
  calls_peak_per_minute: number;
  calls_total: number;
  token_expires_at: string | null;
  token_expires_in_s: number | null;
  cache_entries: number;
  pseudonyms: number;
  last_error: string | null;
  queries: Record<Showcase, number>;
  bronze_reads: number;
}

// ------------------------------------------------------------------ masked-aware person type

/** A person handle: HMAC pseudonym from the backend, stable within one backend process. Never a name. */
export type Pseudonym = `P-${string}`;
const PSEUDONYM_RE = /^P-[0-9a-f]{6,16}$/;
export function isPseudonym(v: unknown): v is Pseudonym {
  return typeof v === 'string' && PSEUDONYM_RE.test(v);
}

/**
 * A person as the UI may show it. `key` is the pseudonym in every mode (filter, cross-link and track by it);
 * `label` is the pseudonym in masked mode, the real name only when the backend runs with -Real, and null
 * when the source has no name (QDASH-8: show that honestly, never invent a label).
 */
export interface MaskedPerson {
  key: Pseudonym;
  label: string | null;
  mode: Mode;
}

export function personOf(row: Record<string, unknown>, keyCol: string, labelCol: string | null, mode: Mode): MaskedPerson | null {
  const key = row[keyCol];
  if (!isPseudonym(key)) return null;
  const label = labelCol ? row[labelCol] : key;
  return { key, label: typeof label === 'string' && label !== '' ? label : null, mode };
}

export function personText(p: MaskedPerson): string {
  if (p.label == null) return `${p.key} (ohne Namen)`;
  return p.mode === 'masked' ? p.key : p.label;
}

// ------------------------------------------------------------------ service

function toApiError(e: unknown): ApiError {
  if (!(e instanceof HttpErrorResponse)) return { status: -1, message: String(e) };
  if (e.status === 0) {
    return { status: 0, message: 'Das Backend ist nicht erreichbar. Mit demo\\run.ps1 oder demo\\dev.ps1 -Showcase <ac> starten.' };
  }
  const body = e.error as { error?: unknown } | null;
  const message = body && typeof body.error === 'string' ? body.error : e.message;
  const retry = Number(e.headers.get('Retry-After'));
  return { status: e.status, message, retryAfterS: Number.isFinite(retry) && retry > 0 ? retry : undefined };
}

/** The only door to the backend. The browser never talks to Fabric and never sends DAX. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  /** Responses the backend answered from Fabric (cached === false) since the app loaded. */
  readonly fabricCalls = signal(0);
  /** Every named-query request this tab issued, cached or not. */
  readonly requests = signal(0);
  /** Masking mode as last reported by the backend. */
  readonly mode = signal<Mode | null>(null);

  query<R>(showcase: Showcase, name: string, params: QueryParams): Observable<QueryResult<R>> {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') hp = hp.set(k, v);
    }
    this.requests.update((n) => n + 1);
    const path = name.split('/').map(encodeURIComponent).join('/');
    return this.http.get<QueryResult<R>>(`/api/${showcase}/q/${path}`, { params: hp }).pipe(
      tap((r) => {
        if (!r.cached) this.fabricCalls.update((n) => n + 1);
        this.mode.set(r.mode);
      }),
      catchError((e: unknown) => throwError(() => toApiError(e))),
    );
  }

  /** A showcase's own (non-query) GET route, e.g. /api/ac1/locations. Same error mapping. */
  get<T>(showcase: Showcase, path: string, params: QueryParams = {}): Observable<T> {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') hp = hp.set(k, v);
    }
    return this.http
      .get<T>(`/api/${showcase}/${path.replace(/^\//, '')}`, { params: hp })
      .pipe(catchError((e: unknown) => throwError(() => toApiError(e))));
  }

  health(): Observable<Health> {
    return this.http.get<Health>('/api/health').pipe(
      tap((h) => this.mode.set(h.mode)),
      catchError((e: unknown) => throwError(() => toApiError(e))),
    );
  }
}
