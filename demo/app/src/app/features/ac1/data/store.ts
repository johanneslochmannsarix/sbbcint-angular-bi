import { Injectable, computed, effect, signal, untracked } from '@angular/core';
import { Env, MaskedPerson, QueryParams, isPseudonym } from '../../../core/api';
import { addDays, isoDay, localMs, today } from '../../../core/format';
import { createGet, queryFactory } from '../../../core/query';
import { NONE, groupKey } from './colors';
import {
  AUDIENCES,
  Audience,
  DAY,
  DayRow,
  LocationsResponse,
  MonthRow,
  PeriodRow,
  PersonRow,
  TagRow,
  cohortOf,
  spanOf,
} from './model';

const query = queryFactory('ac1');

export interface Related {
  key: string;
  audience: Audience;
  /** why this row is in the Gantt: same order on that day, and/or named in the free text */
  sameOrder: boolean;
  tags: string[];
}

/**
 * Shared selection of the AC-1 page (provided by the page, one per visit). The drill-down is
 * month -> day -> person day plan, from either audience; the map clock is shared with the Gantt.
 */
@Injectable()
export class Ac1Store {
  readonly env = signal<Env>('PROD');
  readonly audience = signal<Audience>('ausbilder');
  /** «ansehen als»: the pseudonym whose plan the page shows (stands in for per-person access) */
  readonly person = signal<string | null>(null);
  /** first day of the shown month (ms, local) */
  readonly month = signal<number>(firstOfMonth(today()));
  readonly day = signal<number | null>(null);
  /** map / Gantt clock, minutes after 00:00 of the selected day */
  readonly minute = signal(8 * 60);
  readonly playing = signal(false);
  /** tour hovered in the Gantt (tourKey), highlighted on the map */
  readonly hoverTour = signal<string | null>(null);
  readonly cohort = signal<string | null>(null);
  /** Monday of the cohort week (ms) */
  readonly week = signal<number>(monday(today()));

  private readonly base = computed<QueryParams>(() => ({ env: this.env() }));

  readonly persons = query<PersonRow>(() => ({ name: 'persons', params: this.base() }));
  readonly months = query<MonthRow>(() => ({ name: 'months', params: this.base() }));
  readonly asOf = query<{ datenstand_local: string | null }>(() => ({ name: 'data_as_of', params: this.base() }));
  readonly monthTours = query<PeriodRow>(() => {
    const m = this.month();
    return { name: 'period_tours', params: { ...this.base(), date_from: isoDay(m), date_to: isoDay(addDays(nextMonth(m), -1)) } };
  });
  readonly weekTours = query<PeriodRow>(() => {
    const w = this.week();
    return { name: 'period_tours', params: { ...this.base(), date_from: isoDay(w), date_to: isoDay(addDays(w, 6)) } };
  });
  readonly dayTours = query<DayRow>(() => {
    const d = this.day();
    return d == null ? null : { name: 'day_tours', params: { ...this.base(), day: isoDay(d) } };
  });
  readonly dayTags = createGet<{ rows: TagRow[]; mode: string }>('ac1', () => {
    const d = this.day();
    return d == null ? null : { path: 'day_tags', params: { ...this.base(), day: isoDay(d) } };
  });
  readonly locations = createGet<LocationsResponse>('ac1', () => ({ path: 'locations', params: this.base() }));

  // ------------------------------------------------------------------ people

  readonly mode = computed(() => this.persons.result()?.mode ?? 'masked');
  /** pseudonym -> label (pseudonym itself when masked) and the audiences it belongs to */
  readonly people = computed(() => {
    const m = new Map<string, { person: MaskedPerson; audiences: Set<Audience>; tourDays: number }>();
    const mode = this.mode();
    for (const r of this.persons.rows()) {
      if (!isPseudonym(r.person_sk)) continue;
      let e = m.get(r.person_sk);
      if (!e) {
        const label = typeof r.person_name === 'string' && r.person_name !== '' ? r.person_name : null;
        e = { person: { key: r.person_sk, label, mode }, audiences: new Set(), tourDays: 0 };
        m.set(r.person_sk, e);
      }
      e.audiences.add(r.audience);
      e.tourDays = Math.max(e.tourDays, r.tour_days ?? 0);
    }
    return m;
  });
  readonly audienceList = computed(() => {
    const aud = this.audience();
    return [...this.people().values()]
      .filter((p) => p.audiences.has(aud))
      .sort((a, b) => (b.tourDays > 0 ? 1 : 0) - (a.tourDays > 0 ? 1 : 0) || label(a.person).localeCompare(label(b.person)));
  });
  readonly focus = computed(() => {
    const p = this.person();
    return p ? (this.people().get(p) ?? null) : null;
  });

  audienceOf(key: string): Audience {
    const a = this.people().get(key)?.audiences;
    if (!a) return 'ausbilder';
    if (a.size > 1) return this.audience();
    return [...a][0];
  }
  personOf(key: string): MaskedPerson {
    return this.people().get(key)?.person ?? { key: key as `P-${string}`, label: null, mode: this.mode() };
  }

  // ------------------------------------------------------------------ derived rows

  readonly monthRowsByPerson = computed(() => groupBy(this.monthTours.rows(), (r) => r.person_sk));
  readonly focusMonthRows = computed(() => {
    const p = this.person();
    return p ? (this.monthRowsByPerson().get(p) ?? []) : [];
  });
  readonly dayRowsByPerson = computed(() => groupBy(this.dayTours.rows(), (r) => r.person_sk));
  readonly tags = computed(() => this.dayTags.result()?.rows ?? []);

  /** Gantt rows for the focus person's day: the person, then everyone linked by the same order that day or
   *  by the free-text tags. Never «his trainees»: each row says why it is there. */
  readonly related = computed<Related[]>(() => {
    const focus = this.person();
    if (!focus) return [];
    const aud = this.audience();
    const other: Audience = aud === 'ausbilder' ? 'auszubildende' : 'ausbilder';
    const byPerson = this.dayRowsByPerson();
    const orders = new Set((byPerson.get(focus) ?? []).map((r) => r.dor_name).filter((x): x is string => !!x));
    const out = new Map<string, Related>();
    const add = (key: string, audience: Audience, sameOrder: boolean, tag?: string) => {
      if (key === focus) return;
      let e = out.get(key);
      if (!e) out.set(key, (e = { key, audience, sameOrder: false, tags: [] }));
      e.sameOrder ||= sameOrder;
      if (tag && !e.tags.includes(tag)) e.tags.push(tag);
    };
    for (const [key, rows] of byPerson) {
      if (key === focus || !this.people().get(key)?.audiences.has(other)) continue;
      if (rows.some((r) => r.dor_name && orders.has(r.dor_name))) add(key, other, true);
    }
    for (const t of this.tags()) {
      if (t.match !== 'one' || !t.linked_sk) continue;
      if (t.person_sk === focus) add(t.linked_sk, this.audienceOf(t.linked_sk), false, t.tag);
      else if (t.linked_sk === focus) add(t.person_sk, this.audienceOf(t.person_sk), false, t.tag);
    }
    return [...out.values()].sort((a, b) => Number(b.tags.length > 0) - Number(a.tags.length > 0) || a.key.localeCompare(b.key));
  });
  /** tag names of the focus person's tours that do not resolve to exactly one person (masked tokens) */
  readonly unresolvedTags = computed(() =>
    this.tags().filter((t) => t.person_sk === this.person() && t.match !== 'one'),
  );

  /** cohorts present in the month (trainee rows only), largest first */
  readonly cohorts = computed(() => {
    const m = new Map<string, Set<string>>();
    for (const r of this.monthTours.rows()) {
      const c = cohortOf(r.dor_name);
      if (!c || !this.people().get(r.person_sk)?.audiences.has('auszubildende')) continue;
      (m.get(c) ?? m.set(c, new Set()).get(c)!).add(r.person_sk);
    }
    return [...m.entries()].map(([name, ps]) => ({ name, size: ps.size })).sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  });

  readonly dayRange = computed(() => {
    const d = this.day();
    return d == null ? null : { from: d, to: d + DAY };
  });
  readonly clock = computed(() => {
    const d = this.day();
    return d == null ? null : d + this.minute() * 60_000;
  });

  constructor() {
    // default «ansehen als»: the person of the audience with most tour days (only when nothing valid is picked)
    effect(() => {
      const list = this.audienceList();
      const cur = untracked(() => this.person());
      if (!list.length) return;
      if (!cur || !list.some((p) => p.person.key === cur)) {
        const best = [...list].sort((a, b) => b.tourDays - a.tourDays)[0];
        this.person.set(best.person.key);
      }
    });
    // default cohort: the largest of the month
    effect(() => {
      const cs = this.cohorts();
      const cur = untracked(() => this.cohort());
      if (cs.length && (!cur || !cs.some((c) => c.name === cur))) this.cohort.set(cs[0].name);
    });
    // a new day starts the clock at the focus person's first planned tour
    effect(() => {
      const d = this.day();
      const rows = this.dayRowsByPerson().get(this.person() ?? '') ?? [];
      if (d == null) return;
      const starts = rows.map((r) => spanOf(r)?.start).filter((s): s is number => s != null && s >= d && s < d + DAY);
      // rounded UP to the 15-min step, so the person is already on duty at the first clock position
      untracked(() => this.minute.set(starts.length ? Math.min(23 * 60 + 45, Math.ceil((Math.min(...starts) - d) / 60_000 / 15) * 15) : 8 * 60));
    });
  }

  // ------------------------------------------------------------------ actions

  setAudience(a: Audience): void {
    if (a !== this.audience()) this.audience.set(a);
  }
  /** jump to a person's plan (from a Gantt row, a map label or the cohort grid), keeping the day */
  openPerson(key: string, audience?: Audience, day?: number): void {
    const aud = audience ?? this.audienceOf(key);
    this.audience.set(aud);
    this.person.set(key);
    if (day != null) {
      this.day.set(day);
      const m = firstOfMonth(day);
      if (m !== this.month()) this.month.set(m);
    }
  }
  openDay(day: number): void {
    this.day.set(day);
    const m = firstOfMonth(day);
    if (m !== this.month()) this.month.set(m);
    this.week.set(monday(day));
  }
  shiftMonth(n: number): void {
    const d = new Date(this.month());
    const m = new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
    this.month.set(m);
    // a selected day outside the shown month would leave the trail (and Gantt / map) on another month
    const day = this.day();
    if (day != null && firstOfMonth(day) !== m) this.day.set(null);
  }
}

export function label(p: MaskedPerson): string {
  return p.mode === 'masked' || p.label == null ? p.key : p.label;
}
export function firstOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
export function nextMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}
export function monday(ms: number): number {
  const d = new Date(ms);
  const wd = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd).getTime();
}
export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return m;
}
export function dayOf(r: { date: string }): number | null {
  return localMs(r.date.slice(0, 10) + 'T00:00:00');
}
export { AUDIENCES, NONE, groupKey };
