/**
 * Hour bucketing for the SOLL coverage view (view 2) - the one app-side computation besides layout
 * (PLAN §13 handover: "positions, quantiles of returned per-row values, hour bucketing"; listed in
 * backend/queries/ac8/README.md). SOLL and planned go through the same arithmetic: a shift adds the share of
 * every clock hour it overlaps (a 06:30-14:00 shift adds 0.5 to 06h and 1.0 to 07h-13h).
 *
 * Week grid: 168 slots, slot = weekday * 24 + hour, weekday 0 = Monday (as dim_musterwoche_tag / gold
 * weekday_from_ms).
 */
export const SLOTS = 168;
const HOUR = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR;

/** SOLL: ms-of-week offsets (0 = Mo 00:00). An end past the week wraps onto Monday (Sunday night shifts). */
export function sollOccupancy(rows: { start_ms: number; end_ms: number; soll: number }[]): Float64Array {
  const out = new Float64Array(SLOTS);
  for (const r of rows) {
    if (r.start_ms == null || r.end_ms == null || r.end_ms <= r.start_ms) continue;
    let t = r.start_ms;
    while (t < r.end_ms) {
      const slotStart = Math.floor(t / HOUR) * HOUR;
      const next = Math.min(slotStart + HOUR, r.end_ms);
      const slot = Math.floor((((slotStart % WEEK_MS) + WEEK_MS) % WEEK_MS) / HOUR);
      out[slot] += ((next - t) / HOUR) * (r.soll || 1);
      t = next;
    }
  }
  return out;
}

/** Monday-based weekday of a local timestamp. */
export function weekday(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

/**
 * Planned: local wall-clock intervals. Returns the summed overlap per week slot (not yet averaged).
 * Hour boundaries come from the epoch (Zurich offsets are whole hours), never from a local Date rebuilt with
 * new Date(y, m, d, h): in the repeated hour of the autumn DST switch that yields the FIRST 02:00, the step
 * never advances and the loop hangs (the page froze on a window containing 2026-10-25).
 */
export function plannedOccupancy(intervals: [number, number][]): Float64Array {
  const out = new Float64Array(SLOTS);
  for (const [s, e] of intervals) {
    if (!(e > s) || e - s > 7 * 24 * HOUR) continue;
    let t = s;
    while (t < e) {
      const next = Math.min(Math.floor(t / HOUR) * HOUR + HOUR, e);
      out[weekday(t) * 24 + new Date(t).getHours()] += (next - t) / HOUR;
      t = next;
    }
  }
  return out;
}

/** How many times each weekday occurs in [fromMs, toMs] (calendar days, both inclusive). */
export function weekdayCounts(fromMs: number, toMs: number): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (let d = new Date(fromMs); d.getTime() <= toMs; d.setDate(d.getDate() + 1)) c[weekday(d.getTime())]++;
  return c;
}

/** Average planned occupancy per slot = summed overlap / occurrences of that weekday in the window. */
export function averagePerOccurrence(sum: Float64Array, counts: number[]): Float64Array {
  const out = new Float64Array(SLOTS);
  for (let i = 0; i < SLOTS; i++) {
    const n = counts[Math.floor(i / 24)];
    out[i] = n > 0 ? sum[i] / n : 0;
  }
  return out;
}
