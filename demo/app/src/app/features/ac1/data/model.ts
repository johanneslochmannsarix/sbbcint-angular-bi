/**
 * AC-1 rows as the backend returns them (queries/ac1/*.roles.json) and the pure functions the views share.
 * Plan times only: start_time / end_time are the planned order-item window (naive local time); nothing here
 * knows an executed / IST time. Every person is a pseudonym handle (`P-…`); labels come from `persons`.
 */
import { localMs } from '../../../core/format';

export type Audience = 'ausbilder' | 'auszubildende';
export const AUDIENCES: readonly Audience[] = ['ausbilder', 'auszubildende'];
export const AUDIENCE_LABEL: Record<Audience, string> = { ausbilder: 'Ausbilder', auszubildende: 'Auszubildende' };

export interface PersonRow {
  person_sk: string;
  person_name: string | null;
  audience: Audience;
  tour_days: number | null;
}
export interface MonthRow {
  year_month: string;
  rows_ausbilder: number | null;
  rows_auszubildende: number | null;
}
export interface PeriodRow {
  person_sk: string;
  date: string;
  tourbezeichnung: string | null;
  start_time: string | null;
  end_time: string | null;
  dor_name: string | null;
  activity_group: string | null;
  n: number | null;
}
export interface DayRow {
  person_sk: string;
  tourbezeichnung: string | null;
  zugnummer: string | null;
  start_time: string | null;
  end_time: string | null;
  start_location: string | null;
  end_location: string | null;
  kommentar: string | null;
  dor_name: string | null;
  activity_group: string | null;
  label_de: string | null;
  n: number | null;
}
export type TagKind = 'ALP' | 'TN' | 'PRUEFER';
export const TAG_LABEL: Record<TagKind, string> = { ALP: 'ALP', TN: 'TN', PRUEFER: 'Prüfer' };
export interface TagRow {
  person_sk: string;
  tourbezeichnung: string | null;
  start_time: string | null;
  tag: TagKind;
  tag_index: number;
  tag_name: string | null;
  linked_sk: string | null;
  linked_audience: string | null;
  match: 'one' | 'several' | 'none' | 'empty';
}
/** withheld = address-like by name: no coordinates and no name from the backend (Johannes 2026-10-21) */
export interface LocationEntry {
  id: string;
  name: string | null;
  rows: number | null;
  lat: number | null;
  lon: number | null;
  kind: 'station' | 'unclassified' | 'address_like';
  status: 'ok' | 'ambiguous' | 'absent' | 'no_coord' | 'withheld';
}
export interface LocationsResponse {
  env: string;
  source: string;
  locations: LocationEntry[];
  counts: Record<string, number>;
  fetched_at: string;
}

export const DAY = 86_400_000;
export const MIN = 60_000;

/** The cohort is the training order without its month suffix: "RTS TR_EiB2024 2026-10" -> "RTS TR_EiB2024". */
export function cohortOf(dorName: string | null | undefined): string | null {
  if (!dorName) return null;
  return dorName.replace(/\s*\d{4}-\d{2}$/, '').trim() || null;
}

export interface Span {
  start: number;
  end: number;
}

/** Plan window of a row, ms local; a missing end is the start (the fact does the same). */
export function spanOf(r: { start_time: string | null; end_time: string | null }): Span | null {
  const s = localMs(r.start_time);
  if (s == null) return null;
  const e = localMs(r.end_time) ?? s;
  return { start: s, end: Math.max(s, e) };
}

export function clip(s: Span, from: number, to: number): Span | null {
  const a = Math.max(s.start, from);
  const b = Math.min(s.end, to);
  return b > a ? { start: a, end: b } : null;
}

/** Length of the union of spans (overlapping tours of one person count once). */
export function unionMs(spans: Span[]): number {
  const sorted = [...spans].sort((x, y) => x.start - y.start);
  let total = 0;
  let cur: Span | null = null;
  for (const s of sorted) {
    if (!cur || s.start > cur.end) {
      if (cur) total += cur.end - cur.start;
      cur = { ...s };
    } else cur.end = Math.max(cur.end, s.end);
  }
  if (cur) total += cur.end - cur.start;
  return total;
}

/** Greedy lane packing: overlapping bars of one row go into separate lanes. Returns lane per index + count. */
export function lanes(spans: Span[]): { lane: number[]; count: number } {
  const order = spans.map((s, i) => ({ s, i })).sort((a, b) => a.s.start - b.s.start || a.s.end - b.s.end);
  const ends: number[] = [];
  const lane = new Array<number>(spans.length).fill(0);
  for (const { s, i } of order) {
    let l = ends.findIndex((e) => e <= s.start);
    if (l < 0) {
      l = ends.length;
      ends.push(s.end);
    } else ends[l] = s.end;
    lane[i] = l;
  }
  return { lane, count: Math.max(1, ends.length) };
}

export interface DaySummary {
  /** planned hours on that calendar day, overlaps merged, clipped to the day; all-day entries excluded */
  hours: number;
  /** hours per colour key (each key merged on its own) */
  byKey: Map<string, number>;
  /** colour key of an entry that covers the whole calendar day (e.g. a rest day entered as a tour), if any:
   *  shown as «ganztägig», never as 24 planned hours */
  fullDay: string | null;
  tours: number;
  cohorts: Set<string>;
}

/** an entry covering at least this much of a calendar day is «ganztägig», not working time */
const FULL_DAY_MS = 23.5 * 3_600_000;

/** Period rows of one person -> per calendar day (ms) summary. keyOf decides the colour key of a row. */
export function summariseDays(rows: PeriodRow[], keyOf: (r: PeriodRow) => string): Map<number, DaySummary> {
  const byDay = new Map<number, { all: Span[]; byKey: Map<string, Span[]>; fullDay: string | null; tours: Set<string>; cohorts: Set<string> }>();
  for (const r of rows) {
    const d0 = localMs(r.date?.slice(0, 10) + 'T00:00:00');
    const s = spanOf(r);
    if (d0 == null || !s) continue;
    const c = clip(s, d0, d0 + DAY) ?? (s.start === s.end && s.start >= d0 && s.start < d0 + DAY ? s : null);
    let e = byDay.get(d0);
    if (!e) byDay.set(d0, (e = { all: [], byKey: new Map(), fullDay: null, tours: new Set(), cohorts: new Set() }));
    e.tours.add(`${r.tourbezeichnung}|${r.start_time}`);
    const co = cohortOf(r.dor_name);
    if (co) e.cohorts.add(co);
    if (!c) continue;
    const k = keyOf(r);
    if (c.end - c.start >= FULL_DAY_MS) {
      e.fullDay ??= k;
      continue;
    }
    e.all.push(c);
    (e.byKey.get(k) ?? e.byKey.set(k, []).get(k)!).push(c);
  }
  const out = new Map<number, DaySummary>();
  for (const [d, e] of byDay) {
    const byKey = new Map<string, number>();
    for (const [k, spans] of e.byKey) byKey.set(k, unionMs(spans) / 3_600_000);
    out.set(d, { hours: unionMs(e.all) / 3_600_000, byKey, fullDay: e.fullDay, tours: e.tours.size, cohorts: e.cohorts });
  }
  return out;
}

/** Where a person is at time t according to PLAN. No interpolation: on a tour from A to B the person is
 *  "on the line A -> B", never at a computed point. */
export type Position =
  | { kind: 'tour'; row: DayRow; moving: boolean }
  | { kind: 'between'; at: string | null; after: DayRow }
  | { kind: 'off'; reason: 'before' | 'after' };

export function positionAt(rows: DayRow[], t: number): Position {
  const spans = rows.map((r) => ({ r, s: spanOf(r) })).filter((x): x is { r: DayRow; s: Span } => !!x.s);
  const active = spans.filter((x) => x.s.start <= t && t < x.s.end).sort((a, b) => b.s.start - a.s.start);
  if (active.length) {
    // the latest-started tour wins; a moving one (von != nach) is preferred over a stationary one
    const moving = active.find((x) => x.r.start_location && x.r.end_location && x.r.start_location !== x.r.end_location);
    const pick = moving ?? active[0];
    return { kind: 'tour', row: pick.r, moving: !!moving };
  }
  const done = spans.filter((x) => x.s.end <= t).sort((a, b) => b.s.end - a.s.end);
  const later = spans.some((x) => x.s.start > t);
  if (done.length && later) return { kind: 'between', at: done[0].r.end_location, after: done[0].r };
  return { kind: 'off', reason: done.length ? 'after' : 'before' };
}

export function tourKey(r: { person_sk: string; tourbezeichnung: string | null; start_time: string | null }): string {
  return `${r.person_sk}|${r.tourbezeichnung ?? ''}|${r.start_time ?? ''}`;
}
