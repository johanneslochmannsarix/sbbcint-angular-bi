import { ChartTokens } from '../core/tokens';

/** Plain-object option fragments (no echarts import here, so pages stay free of the echarts bundle). */
/** echarts 6: no containLabel (it warns without LegacyGridContainLabel); the grid shrinks until axis
 *  labels fit inside outerBounds, which is the containLabel behaviour. */
export function grid(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const m = { left: 4, right: 16, top: 36, bottom: 4, ...extra };
  return { ...m, outerBounds: { left: m.left, right: m.right, top: m.top, bottom: m.bottom } };
}

export function legendTop(t: Pick<ChartTokens, 'ink2'>): Record<string, unknown> {
  return { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: t.ink2 } };
}

/** Bars: <= 24 px, 4 px rounded data end, square at the baseline. */
export function barStyle(color: string, horizontal: boolean): Record<string, unknown> {
  return { color, borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] };
}

/**
 * echarts aria for every chart: `aria: ariaDecal()`. Decals are OFF by default (core request ac8 #4, D2
 * 2026-10-21): `decal.show: true` paints a pattern on every item, which buries sankey nodes and thin
 * themeRiver streams. Where the shape itself must carry a state (unbesetzt, gelöscht, Unterdeckung), set a
 * decal on that item or series only: `itemStyle: { decal: { symbol: 'rect', dashArrayX: [1, 0],
 * dashArrayY: [2, 4], rotation: Math.PI / 4, color } }` (AC-8 keeps its set in features/ac8/data/palette.ts
 * DECAL). `ariaDecal(true)` restores echarts' automatic decal on every series.
 */
export function ariaDecal(show = false): Record<string, unknown> {
  return { enabled: true, decal: { show } };
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** One tooltip row: colour key + label + value (text never wears the series colour). */
export function ttRow(color: string | null, label: string, value: string): string {
  const key = color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>` : '';
  return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${key}${esc(label)}</span><b style="font-variant-numeric:tabular-nums">${esc(value)}</b></div>`;
}
export function ttHead(s: string): string {
  return `<div style="font-weight:600;margin-bottom:4px">${esc(s)}</div>`;
}
