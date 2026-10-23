import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Env, Tenant } from './api';
import { DataStore, Person } from './model';

/**
 * The shared selection (view 7). The heatmap brush sets a block of people; the calendar, the treemap and
 * the histogram read `people()`. Everything is client side over the same loaded pairs: no extra Fabric call.
 * A person (drawer) and a focus qualification (treemap leaf / swimlane lane) are separate, narrower picks.
 */
@Injectable({ providedIn: 'root' })
export class SelectionService {
  private readonly store = inject(DataStore);

  /** pseudonyms selected by the heatmap brush; null = no selection = everyone */
  readonly brushed = signal<ReadonlySet<string> | null>(null);
  readonly brushLabel = signal('');
  /** person opened in the drawer (pseudonym) */
  readonly person = signal<string | null>(null);
  /** qualification focused from the treemap or the swimlanes */
  readonly qualification = signal<string | null>(null);

  readonly people = computed<Person[]>(() => {
    const m = this.store.model();
    if (!m) return [];
    const b = this.brushed();
    return b ? m.persons.filter((p) => b.has(p.key)) : m.persons;
  });
  readonly active = computed(() => this.brushed() !== null);

  /** a person to open once the tenant/env switch below has cleared the old picks (cross-link, story mode) */
  private pendingPerson: string | null = null;

  constructor() {
    // a new tenant/env invalidates every pick (pseudonyms and ids differ per dataset)
    effect(() => {
      this.store.tenant();
      this.store.env();
      untracked(() => {
        this.clear(true);
        if (this.pendingPerson) this.person.set(this.pendingPerson);
        this.pendingPerson = null;
      });
    });
  }

  /** Open one person's drawer in a tenant/env (cross-links from AC-1 / AC-8, story mode). The pseudonym is
   *  resolved server side; an unknown one shows «keine Qualifikationsdaten» in the drawer. */
  openPerson(key: string, tenant: Tenant, env: Env): void {
    if (this.store.tenant() === tenant && this.store.env() === env) {
      this.person.set(key);
      return;
    }
    this.pendingPerson = key;
    this.store.tenant.set(tenant);
    this.store.env.set(env);
  }

  setBrush(keys: string[], label: string): void {
    this.brushed.set(keys.length ? new Set(keys) : null);
    this.brushLabel.set(keys.length ? label : '');
  }
  clear(all = false): void {
    this.brushed.set(null);
    this.brushLabel.set('');
    if (all) {
      this.person.set(null);
      this.qualification.set(null);
    }
  }
}
