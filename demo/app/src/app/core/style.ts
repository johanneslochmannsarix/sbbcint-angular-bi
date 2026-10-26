import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { StyleVariant, useFonts } from './tokens';

export type { StyleVariant } from './tokens';

const KEY = 'demo-app.style';
const COLORS_KEY = 'demo-app.sbb-colors';
/** the lazy stylesheet bundle (angular.json: styles-sbb.css, bundleName "sbb", inject false) */
const SBB_CSS_ID = 'sbb-style-bundle';
const SBB_CSS_HREF = 'sbb.css';

function param(name: string): string | null {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get(name);
  } catch {
    return null;
  }
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the switch still works for this tab */
  }
}

/** `?style=` wins (and is remembered), then the remembered choice, then the demo's own style. */
function readVariant(): StyleVariant {
  const v = param('style') ?? stored(KEY);
  return v === 'sbb' ? 'sbb' : 'demo';
}

/** `?colors=off-brand` (remembered): SBB's security-critical style, red only for errors (typography.md). */
function readOffBrand(): boolean {
  const v = param('colors') ?? stored(COLORS_KEY);
  return v === 'off-brand';
}

/**
 * The style variant of the whole app: the demo's own look or the customer's (SBB lean design system,
 * @sbb-esta/angular). Same routes, queries and texts in both; only the shell (app.html), the tokens and the
 * shared controls (shared/ui) read it.
 *
 * sbb: loads the lazy stylesheet bundle sbb.css (SBB typography.css + the token mapping in styles-sbb.css) and
 * sets `sbb-lean` on <html>; ThemeService adds `sbb-light` / `sbb-dark`. demo: disables that stylesheet and
 * removes the classes, so nothing of SBB's CSS reaches the demo variant.
 */
@Injectable({ providedIn: 'root' })
export class StyleService {
  private readonly doc = inject(DOCUMENT);

  readonly variant = signal<StyleVariant>(readVariant());
  readonly offBrand = signal(readOffBrand());
  /** +1 whenever sbb.css has (re)applied: the SBB chart font is readable from then on (tokens.ts useFonts) */
  readonly fontRev = signal(0);

  constructor() {
    useFonts(this.variant());
    effect(() => {
      const v = this.variant();
      const root = this.doc.documentElement;
      root.classList.toggle('sbb-lean', v === 'sbb');
      root.classList.toggle('sbb-off-brand-colors', v === 'sbb' && this.offBrand());
      this.stylesheet(v === 'sbb');
      if (v === 'sbb') this.leanComponents();
      store(KEY, v);
      store(COLORS_KEY, this.offBrand() ? 'off-brand' : 'brand');
    });
  }

  set(v: StyleVariant): void {
    useFonts(v);
    this.variant.set(v);
  }

  toggle(): void {
    this.set(this.variant() === 'sbb' ? 'demo' : 'sbb');
  }

  private fontsFromCss(): void {
    if (this.variant() !== 'sbb') return;
    useFonts('sbb');
    this.fontRev.update((n) => n + 1);
  }

  private stylesheet(on: boolean): void {
    let link = this.doc.getElementById(SBB_CSS_ID) as HTMLLinkElement | null;
    if (!link && on) {
      link = this.doc.createElement('link');
      link.id = SBB_CSS_ID;
      link.rel = 'stylesheet';
      link.href = SBB_CSS_HREF;
      link.addEventListener('load', () => this.fontsFromCss());
      this.doc.head.appendChild(link);
      return;
    }
    if (link) {
      const wasOff = link.disabled;
      link.disabled = !on;
      if (on && wasOff && link.sheet) this.fontsFromCss();
    }
  }

  /**
   * SBB components read the design variant ONCE, when SbbCommonModule is constructed (fesm2022/core.mjs:
   * `ɵvariant.next(html.sbb-lean ? 'lean' : 'standard')`), e.g. the select arrow and button icons. Our shared
   * controls import them, so that can happen while the demo variant shows; switching to sbb would then render the
   * standard variant. Re-announce lean after every switch (exported ɵ API, pinned 22.2.0; lazy, not in the
   * initial bundle).
   */
  private leanComponents(): void {
    import('@sbb-esta/angular/core').then((m) => m.ɵvariant.next('lean')).catch(() => undefined);
  }
}
