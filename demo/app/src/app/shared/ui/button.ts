import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SbbButton } from '@sbb-esta/angular/button';
import { StyleService } from '../../core/style';

/**
 * A button (`button.btn`). The click reaches the host, so the page binds (click) on <ui-button> as before.
 *
 *   <ui-button kind="ghost" label="Vorherige Woche" (click)="shift(-7)">‹</ui-button>
 *
 * demo: today's markup (button.btn[.btn-primary|.btn-ghost][.is-on]); host display: contents. sbb (button.md):
 * primary or `on` -> sbb-button, ghost -> sbb-ghost-button, default -> sbb-secondary-button.
 */
@Component({
  selector: 'ui-button',
  imports: [NgTemplateOutlet, SbbButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <ng-template #content><ng-content /></ng-template>
    @if (sbb()) {
      @defer (on immediate) {
        @switch (sbbKind()) {
          @case ('primary') {
            <button type="button" sbb-button [class]="extraClass()" [disabled]="disabled()" [attr.title]="tip()" [attr.aria-label]="label()" [attr.aria-pressed]="pressed()">
              <ng-container [ngTemplateOutlet]="content" />
            </button>
          }
          @case ('ghost') {
            <button type="button" sbb-ghost-button [class]="extraClass()" [disabled]="disabled()" [attr.title]="tip()" [attr.aria-label]="label()" [attr.aria-pressed]="pressed()">
              <ng-container [ngTemplateOutlet]="content" />
            </button>
          }
          @default {
            <button type="button" sbb-secondary-button [class]="extraClass()" [disabled]="disabled()" [attr.title]="tip()" [attr.aria-label]="label()" [attr.aria-pressed]="pressed()">
              <ng-container [ngTemplateOutlet]="content" />
            </button>
          }
        }
      }
    } @else {
      <button type="button" [class]="demoClass()" [disabled]="disabled()" [attr.title]="tip()" [attr.aria-label]="label()" [attr.aria-pressed]="pressed()" [attr.autofocus]="autofocus() ? '' : null">
        <ng-container [ngTemplateOutlet]="content" />
      </button>
    }
  `,
})
export class UiButton {
  private readonly style = inject(StyleService);

  readonly kind = input<'default' | 'primary' | 'ghost'>('default');
  /** a latched state (the demo's `.is-on`) */
  readonly on = input(false);
  readonly disabled = input(false);
  /** title (tooltip) */
  readonly tip = input<string | null>(null);
  /** aria-label, for symbol-only buttons */
  readonly label = input<string | null>(null);
  /** aria-pressed, when the button is a toggle */
  readonly pressed = input<boolean | null>(null);
  readonly extraClass = input('');
  /** the autofocus attribute, as on the demo's drawer close buttons */
  readonly autofocus = input(false);

  protected readonly sbb = computed(() => this.style.variant() === 'sbb');
  protected readonly sbbKind = computed(() => (this.kind() === 'primary' || this.on() ? 'primary' : this.kind()));
  protected readonly demoClass = computed(() => {
    const k = this.kind();
    return ['btn', k === 'primary' ? 'btn-primary' : k === 'ghost' ? 'btn-ghost' : '', this.on() ? 'is-on' : '', this.extraClass()]
      .filter(Boolean)
      .join(' ');
  });
}
