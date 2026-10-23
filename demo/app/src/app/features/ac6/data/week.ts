/**
 * Pattern-week helpers. A JUP is a week template without calendar dates: fico_planung carries offsets in ms from
 * Monday 00:00 (*_ms) and the weekday of the tour start (musterwochentag_nr 0 = Mo … 6 = So, 7 = «Mo+1», a tour
 * starting after Sunday 24:00). Layout only: positions and labels, no business number.
 */
export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
export const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So', 'Mo+1'] as const;
export const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag', 'Montag der Folgewoche'] as const;

/** «Di 06:30» for a week offset; past Sunday 24:00 it reads «Mo+1 02:10». */
export function weekTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  const d = Math.floor(ms / DAY_MS);
  const rest = ms - d * DAY_MS;
  const h = Math.floor(rest / 3_600_000);
  const m = Math.round((rest - h * 3_600_000) / 60_000);
  const hh = m === 60 ? h + 1 : h;
  return `${DAY_SHORT[Math.min(d, 7)]} ${String(hh).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
}

/** «06:30» (time of day only) */
export function clock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  const rest = ((ms % DAY_MS) + DAY_MS) % DAY_MS;
  const h = Math.floor(rest / 3_600_000);
  const m = Math.round((rest - h * 3_600_000) / 60_000);
  return `${String(m === 60 ? h + 1 : h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
}

/** «Mi 14–15 h» for an hour of the week (0 … 167) */
export function hourLabel(k: number): string {
  const d = Math.floor(k / 24);
  const h = k % 24;
  return `${DAY_SHORT[d]} ${String(h).padStart(2, '0')}–${String(h + 1).padStart(2, '0')} h`;
}
