/**
 * Formatting, de-CH. AC-2 conventions (num() defaults to 0 digits; model dates are naive calendar dates)
 * plus the metrics-app helpers (utcMs, dateTimeLU, minutes ...). Timestamps shown to people: local + UTC.
 */
const LOCALE = 'de-CH';

export const BLANK = '–';
export const BLANK_TITLE = 'Leer: unter diesem Filter nicht berechenbar (unbestätigt, nicht 0).';

// ------------------------------------------------------------------ parsing

/** Model dates arrive as naive 'YYYY-MM-DDT00:00:00' (calendar dates, no zone): parse as a local date. */
export function dayMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}
/** Naive model timestamps that are UTC (collector _ts strips the Z). */
export function utcMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}
/** Naive model timestamps that are local wall-clock time (plan start/end, datenstand_local). */
export function localMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v.replace(/Z$/, ''));
  return Number.isNaN(t) ? null : t;
}
export function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function isoDate(d: Date): string {
  return isoDay(d.getTime());
}
export function today(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate()).getTime();
}

// ------------------------------------------------------------------ display

const dLocal = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
const dLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const dShort = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit' });
const dtLocal = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const tLocal = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const tUtc = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const mShort = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' });
const mLong = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });

/** Every formatter below returns BLANK for a non-finite number: echarts calls axis / dataZoom label
 *  formatters with NaN while a time axis has no extent yet (core request ac8 #2, D2 2026-10-21). */
function bad(ms: number | null | undefined): ms is null | undefined {
  return ms == null || !Number.isFinite(ms);
}

export function dateOnly(v: string | number | null | undefined): string {
  if (v == null) return BLANK;
  const ms = typeof v === 'number' ? v : dayMs(v);
  if (typeof v === 'number' && bad(ms)) return BLANK;
  return ms == null ? String(v) : dLocal.format(ms);
}
export function dateLong(ms: number): string {
  if (bad(ms)) return BLANK;
  return dLong.format(ms);
}
export function dateShort(ms: number): string {
  if (bad(ms)) return BLANK;
  return dShort.format(ms);
}
export function monthShort(ms: number): string {
  if (bad(ms)) return BLANK;
  return mShort.format(ms);
}
export function monthLong(ms: number): string {
  if (bad(ms)) return BLANK;
  return mLong.format(ms);
}
export function isoToDisplay(iso: string): string {
  return dateOnly(iso);
}
export function timeLocal(ms: number): string {
  if (bad(ms)) return BLANK;
  return tLocal.format(ms);
}
/** "15.10.2026 08:12 (06:12 UTC)" */
export function dateTimeLU(ms: number | null): string {
  if (bad(ms)) return BLANK;
  return `${dtLocal.format(ms)} (${tUtc.format(ms)} UTC)`;
}
export function timeLU(ms: number | null): string {
  if (bad(ms)) return BLANK;
  return `${tLocal.format(ms)} (${tUtc.format(ms)} UTC)`;
}
/** A naive local timestamp from the model (datenstand_local): local, plus UTC computed in the browser. */
export function localStamp(v: string | null | undefined): string {
  if (!v) return BLANK;
  const ms = localMs(v);
  return ms == null ? v : dateTimeLU(ms);
}

const nf = new Map<number, Intl.NumberFormat>();
/** Default 0 digits (AC-2). Pass digits explicitly where a fraction matters. */
export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return BLANK;
  let f = nf.get(digits);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    nf.set(digits, f);
  }
  return f.format(v);
}
/** Model '0.0%' measures are fractions. */
export function pct(v: number | null | undefined, digits = 0): string {
  return v == null || !Number.isFinite(v) ? BLANK : `${num(v * 100, digits)} %`;
}
export function hours(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? BLANK : `${num(v, digits)} h`;
}
export function minutes(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return BLANK;
  if (v < 60) return `${num(v, 1)} min`;
  const h = Math.floor(v / 60);
  return `${h} h ${String(Math.round(v - h * 60)).padStart(2, '0')} min`;
}
