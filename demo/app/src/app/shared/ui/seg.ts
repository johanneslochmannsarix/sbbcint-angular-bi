import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { SbbButton } from '@sbb-esta/angular/button';
import { SbbToggle, SbbToggleOption } from '@sbb-esta/angular/toggle';
import { StyleService } from '../../core/style';
import { UiSbbIcons } from './sbb-icons';

export interface UiOption<T> {
  value: T;
  label: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** an extra class on this option's button (e.g. AC-4 marks incomplete months) */
  cls?: string;
}

/**
 * A segmented group (`.seg`): one pressed option out of a few, or (`actions`) a row of plain action buttons.
 *
 *   <ui-seg ariaLabel="Umgebung" [options]="envOptions" [value]="store.env()" (valueChange)="store.setEnv($event)" />
 *
 * demo: today's markup exactly (div.seg[role=group] > button[aria-pressed]); the host is display: contents.
 * sbb: sbb-toggle for 2-3 options with a value (SBB: two options, a third in lean - toggle.md); otherwise (more
 * options, no option pressed, a disabled option, actions) a row of SBB buttons, the pressed one primary.
 * sbb-toggle selects its first option on its own when nothing is selected, and reports that as a change; only
 * a change to a value other than the bound one is passed on.
 */
@Component({
  selector: 'ui-seg',
  imports: [SbbToggle, SbbToggleOption, SbbButton, UiSbbIcons],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (sbb()) {
      @defer (on immediate) {
        <ui-sbb-icons />
        @if (toggle()) {
          <sbb-toggle class="ui-sbb-toggle" [value]="value()" (change)="fromToggle($event.value)" [attr.aria-label]="ariaLabel()" [attr.aria-labelledby]="ariaLabelledby()">
            @for (o of options(); track $index) {
              <sbb-toggle-option [value]="o.value" [label]="o.label" [attr.title]="o.title ?? null" />
            }
          </sbb-toggle>
        } @else {
          <div class="ui-sbb-group" role="group" [attr.aria-label]="ariaLabel()" [attr.aria-labelledby]="ariaLabelledby()">
            @for (o of options(); track $index) {
              @if (!actions() && o.value === value()) {
                <button type="button" sbb-button [class]="o.cls ?? null" aria-pressed="true" [attr.title]="o.title ?? null" [attr.aria-label]="o.ariaLabel ?? null" (click)="pick(o.value)">{{ o.label }}</button>
              } @else {
                <button type="button" sbb-secondary-button [class]="o.cls ?? null" [attr.aria-pressed]="actions() ? null : false" [disabled]="!!o.disabled"
                  [attr.title]="o.title ?? null" [attr.aria-label]="o.ariaLabel ?? null" (click)="pick(o.value)">{{ o.label }}</button>
              }
            }
          </div>
        }
      }
    } @else {
      <div class="seg" [class.seg-sm]="size() === 'sm'" role="group" [attr.aria-label]="ariaLabel()" [attr.aria-labelledby]="ariaLabelledby()">
        @for (o of options(); track $index) {
          <button type="button" [class]="o.cls ?? null" [attr.aria-pressed]="actions() ? null : o.value === value()" [disabled]="!!o.disabled"
            [attr.title]="o.title ?? null" [attr.aria-label]="o.ariaLabel ?? null" (click)="pick(o.value)">{{ o.label }}</button>
        }
      </div>
    }
  `,
})
export class UiSeg<T> {
  private readonly style = inject(StyleService);

  readonly options = input.required<readonly UiOption<T>[]>();
  readonly value = input<T | null>(null);
  readonly ariaLabel = input<string | null>(null);
  /** id of a visible label element, instead of ariaLabel */
  readonly ariaLabelledby = input<string | null>(null);
  readonly size = input<'md' | 'sm'>('md');
  /** plain action buttons (e.g. ‹ ›): never pressed, every click emits */
  readonly actions = input(false);
  readonly valueChange = output<T>();

  protected readonly sbb = computed(() => this.style.variant() === 'sbb');
  protected readonly toggle = computed(() => {
    const opts = this.options();
    const v = this.value();
    return !this.actions() && opts.length >= 2 && opts.length <= 3 && v != null && opts.some((o) => o.value === v) && !opts.some((o) => o.disabled);
  });

  protected pick(v: T): void {
    this.valueChange.emit(v);
  }

  protected fromToggle(v: T): void {
    if (v !== this.value()) this.valueChange.emit(v);
  }
}
