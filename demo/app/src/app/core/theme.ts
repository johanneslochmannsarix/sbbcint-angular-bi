import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';
import { ECHARTS_THEME, Mode, TOKENS } from './tokens';

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

/** Light / dark for the whole app: CSS tokens via [data-theme] on <html>, chart tokens + echarts theme. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly media = this.doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);

  readonly pref = signal<ThemePref>(readPref());
  readonly mode = computed<Mode>(() => (this.pref() === 'system' ? (this.systemDark() ? 'dark' : 'light') : (this.pref() as Mode)));
  readonly tokens = computed(() => TOKENS[this.mode()]);
  readonly echartsTheme = computed(() => ECHARTS_THEME[this.mode()]);

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
  }

  /** system -> the opposite of what is showing -> back to system */
  toggle(): void {
    const p = this.pref();
    if (p === 'system') this.pref.set(this.mode() === 'dark' ? 'light' : 'dark');
    else this.pref.set('system');
  }
}
