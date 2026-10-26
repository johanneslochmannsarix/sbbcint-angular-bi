import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { SbbIconRegistry } from '@sbb-esta/angular/icon';

/**
 * The SBB components we render ask sbb-icon for these names; by default sbb-icon fetches them from the SBB icon
 * CDN (icons.app.sbb.ch, icon.md). Johannes 2026-10-24: no SBB icon files are downloaded or shipped, so each name
 * the components use (found in node_modules/@sbb-esta/angular/fesm2022: header-lean, tabs, select, datepicker,
 * button, table, menu; tabs' chevron-left-small surfaced in the request survey, probes/style/offline_check.mjs)
 * is registered here as a literal we drew ourselves (24 x 24, 1px strokes in currentColor), which the registry
 * serves before it would consult the CDN. Nothing is requested from an SBB host for icons.
 */
const ICONS: Record<string, string> = {
  'chevron-small-down-small': '<path d="M8 10.5l4 4 4-4"/>',
  'chevron-small-left-small': '<path d="M13.5 8l-4 4 4 4"/>',
  'chevron-small-right-small': '<path d="M10.5 8l4 4-4 4"/>',
  'chevron-right-small': '<path d="M9.5 6l6 6-6 6"/>',
  'chevron-left-small': '<path d="M14.5 6l-6 6 6 6"/>',
  'cross-small': '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
  'hamburger-menu-small': '<path d="M5 7.5h14M5 12h14M5 16.5h14"/>',
  'nine-squares-small': '<path d="M6 6h3v3H6zM10.5 6h3v3h-3zM15 6h3v3h-3zM6 10.5h3v3H6zM10.5 10.5h3v3h-3zM15 10.5h3v3h-3zM6 15h3v3H6zM10.5 15h3v3h-3zM15 15h3v3h-3z"/>',
  'calendar-small': '<path d="M5.5 7.5h13v11h-13zM5.5 10.5h13M9 5.5v3M15 5.5v3"/>',
  'arrow-right-small': '<path d="M6 12h12M13.5 7.5L18 12l-4.5 4.5"/>',
  'arrow-down-small': '<path d="M12 6v12M7.5 13.5L12 18l4.5-4.5"/>',
  'plus-small': '<path d="M12 6.5v11M6.5 12h11"/>',
  'context-menu-small': '<path d="M11.5 7h1v1h-1zM11.5 11.5h1v1h-1zM11.5 16h1v1h-1z"/>',
  'user-small': '<path d="M9 9a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M6.5 18.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>',
};

let registered = false;

/**
 * Registers the literals once, before the first SBB component asks for an icon: placed first inside every
 * `@defer` block that renders SBB components (shared/ui, the SBB shell header), so it is created before them
 * and stays out of the demo variant's bundles.
 */
@Component({
  selector: 'ui-sbb-icons',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: none' },
  template: '',
})
export class UiSbbIcons {
  constructor() {
    if (registered) return;
    registered = true;
    const registry = inject(SbbIconRegistry);
    const sanitizer = inject(DomSanitizer);
    for (const [name, body] of Object.entries(ICONS)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">${body}</svg>`;
      registry.addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml(svg));
    }
  }
}
