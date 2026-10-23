import { Injectable, computed, signal } from '@angular/core';
import { Env, QueryParams, Tenant } from './api';
import { addDays, isoDay, today } from './format';

export type WindowSel = { kind: 'default' } | { kind: 'days'; days: number } | { kind: 'custom'; from: string; to: string };
export const MAX_WINDOW_DAYS = 400;

/**
 * App-wide filter state that more than one feature may share (D2 cross-links keep env / tenant when jumping
 * between showcases). A feature with its own selector logic may keep its own signals (AC-2's DataStore
 * does); nothing here issues a request.
 */
@Injectable({ providedIn: 'root' })
export class FiltersService {
  readonly env = signal<Env>('PROD');
  readonly tenant = signal<Tenant>('RTS');
  readonly window = signal<WindowSel>({ kind: 'default' });

  /** the window as ISO dates; 'default' uses the given default length, ending today */
  dates(defaultDays = 30): { from: string; to: string } {
    const w = this.window();
    if (w.kind === 'custom') return { from: w.from, to: w.to };
    const days = w.kind === 'days' ? w.days : defaultDays;
    const t = today();
    return { from: isoDay(addDays(t, -days)), to: isoDay(t) };
  }

  readonly base = computed<QueryParams>(() => ({ env: this.env() }));
  readonly baseWithTenant = computed<QueryParams>(() => ({ env: this.env(), tenant: this.tenant() }));
}
