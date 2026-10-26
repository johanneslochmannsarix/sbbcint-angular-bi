import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';
import { StyleService } from './style';
import { Mode, chartTokens, echartsTheme } from './tokens';

export type ThemePref = 'system' | Mode;
const KEY = 'demo-app.theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Light / dark for the whole app: CSS tokens via [data-theme] on <html>, chart tokens + echarts theme. Tokens and
 * echarts theme also follow the style variant (core/style.ts); in the sbb variant the resolved mode is mirrored
 * as `sbb-light` / `sbb-dark` on <html> (SBB lean dark mode, typography.md), so SBB follows the same toggle.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly media = this.doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);
  private readonly style = inject(StyleService);

  readonly pref = signal<ThemePref>(readPref());
  readonly mode = computed<Mode>(() => (this.pref() === 'system' ? (this.systemDark() ? 'dark' : 'light') : (this.pref() as Mode)));
  /** a fresh object when the sbb chart font arrives (fontRev), so chart options built from it recompute */
  readonly tokens = computed(() => (this.style.fontRev(), { ...chartTokens(this.style.variant(), this.mode()) }));
  readonly echartsTheme = computed(() => echartsTheme(this.style.variant(), this.mode(), this.style.fontRev()));

  constructor() {
    this.media?.addEventListener('change', (e) => this.systemDark.set(e.matches));
    effect(() => {
      const pref = this.pref();
      if (pref === 'system') this.doc.documentElement.removeAttribute('data-theme');
      else this.doc.documentElement.setAttribute('data-theme', pref);
      try {
        if (pref === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, pref);
      } catch {
        /* storage blocked: the toggle still works for this tab */
      }
    });
    effect(() => {
      const sbb = this.style.variant() === 'sbb';
      const root = this.doc.documentElement;
      root.classList.toggle('sbb-light', sbb && this.mode() === 'light');
      root.classList.toggle('sbb-dark', sbb && this.mode() === 'dark');
    });
  }

  /** system -> the opposite of what is showing -> back to system */
  toggle(): void {
    const p = this.pref();
    if (p === 'system') this.pref.set(this.mode() === 'dark' ? 'light' : 'dark');
    else this.pref.set('system');
  }
}
