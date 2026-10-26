import { Injectable, computed, inject } from '@angular/core';
import { ThemeService as CoreTheme } from '../../../core/theme';
import { StyleService } from '../../../core/style';
import { SBB_TOKENS, TOKENS } from './tokens';

/**
 * AC-2's theme facade (was ac2/app/src/app/core/theme.ts): mode, pref and the echarts theme come from the
 * core ThemeService; tokens() are AC-2's status tokens (data/tokens.ts) for the same mode and style variant.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly core = inject(CoreTheme);
  private readonly style = inject(StyleService);
  readonly pref = this.core.pref;
  readonly mode = this.core.mode;
  readonly echartsTheme = this.core.echartsTheme;
  readonly tokens = computed(() => (this.style.variant() === 'sbb' ? SBB_TOKENS : TOKENS)[this.core.mode()]);

  toggle(): void {
    this.core.toggle();
  }
}
