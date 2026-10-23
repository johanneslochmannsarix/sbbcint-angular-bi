import { Injectable, computed, inject } from '@angular/core';
import { ThemeService as CoreTheme } from '../../../core/theme';
import { TOKENS } from './tokens';

/**
 * AC-2's theme facade (was ac2/app/src/app/core/theme.ts): mode, pref and the echarts theme come from the
 * core ThemeService; tokens() are AC-2's status tokens (data/tokens.ts) for the same mode.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly core = inject(CoreTheme);
  readonly pref = this.core.pref;
  readonly mode = this.core.mode;
  readonly echartsTheme = this.core.echartsTheme;
  readonly tokens = computed(() => TOKENS[this.core.mode()]);

  toggle(): void {
    this.core.toggle();
  }
}
