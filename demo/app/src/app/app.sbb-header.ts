import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SbbButtonModule } from '@sbb-esta/angular/button';
import { SbbHeaderLeanModule } from '@sbb-esta/angular/header-lean';
import { SbbTabsModule } from '@sbb-esta/angular/tabs';
import { ApiService } from './core/api';
import { HeaderSlotService } from './core/header-slot';
import { StyleService } from './core/style';
import { ThemeService } from './core/theme';
import { SHOWCASES } from './app.showcases';
import { UiSbbIcons } from './shared/ui/sbb-icons';

/**
 * The shell header of the SBB style variant (core/style.ts), rendered by app.html inside `@defer`, so the demo
 * variant never loads it: sbb-header-lean (header-lean.md) with the masking badge and the style and theme
 * switches in its additional-header-content slot; below it the ten showcase links as an sbb-tab-nav-bar
 * (tabs.md) - ten links do not fit into the lean header (measured at 1600 px: four were cut off); then the page's
 * header slots (core/header-slot.ts). tabs.md wants an sbb-tab-nav-panel around the router outlet; that outlet is
 * shared by both variants (app.html), so the bar runs without tabPanel, which SbbTabNav handles as plain
 * navigation links with aria-current="page" (fesm2022/tabs.mjs, SbbTabLink). The SBB logo is the header's
 * built-in default.
 */
@Component({
  selector: 'app-sbb-header',
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, SbbHeaderLeanModule, SbbTabsModule, SbbButtonModule, UiSbbIcons],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-sbb-icons />
    <div class="sbb-shell-sticky">
      <sbb-header-lean label="Demo">
        <div class="additional-header-content sbb-shell-tools">
          @if (api.mode(); as mode) {
            <span class="mode" [class.mode-real]="mode === 'real'"
              [title]="mode === 'masked' ? 'Personen erscheinen als Pseudonym P-xxxxxx (zufälliger Schlüssel je Backend-Start).' : 'Klarnamen: Backend mit run.ps1 -Real gestartet. Nicht teilen.'">
              {{ mode === 'masked' ? 'Pseudonymisiert' : 'Klarnamen' }}
            </span>
          }
          <button type="button" sbb-ghost-button (click)="style.toggle()" aria-label="Stil: SBB. Umschalten auf Demo.">Stil: SBB</button>
          <button type="button" sbb-ghost-button (click)="theme.toggle()" [attr.aria-label]="'Darstellung: ' + theme.pref() + '. Umschalten.'">
            {{ theme.pref() === 'system' ? 'System' : theme.pref() === 'dark' ? 'Dunkel' : 'Hell' }}
          </button>
        </div>
      </sbb-header-lean>
      <nav sbb-tab-nav-bar class="sbb-shell-tabs" aria-label="Showcases">
        @for (s of showcases; track s.path) {
          <a sbb-tab-link [routerLink]="s.path" routerLinkActive #rla="routerLinkActive" [active]="rla.isActive">{{ s.label }}</a>
        }
      </nav>
      @if (slot.main() || slot.sub()) {
        <div class="sbb-shell-sub">
          @if (slot.main(); as t) {
            <div class="slot-main"><ng-container [ngTemplateOutlet]="t" /></div>
          }
        </div>
        @if (slot.sub(); as t) {
          <div class="slot-sub"><ng-container [ngTemplateOutlet]="t" /></div>
        }
      }
    </div>
  `,
})
export class SbbHeader {
  protected readonly style = inject(StyleService);
  protected readonly theme = inject(ThemeService);
  protected readonly api = inject(ApiService);
  protected readonly slot = inject(HeaderSlotService);
  protected readonly showcases = SHOWCASES;
}
