import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { SbbOption } from '@sbb-esta/angular/core';
import { SbbFormField } from '@sbb-esta/angular/form-field';
import { SbbSelect } from '@sbb-esta/angular/select';
import { StyleService } from '../../core/style';
import { UiSbbIcons } from './sbb-icons';

export interface UiSelectOption {
  value: string;
  label: string;
}

/**
 * A single-choice dropdown (`select.select`). Values are strings, as a native select's are; the page converts.
 *
 *   <ui-select ariaLabel="Kohorte" [options]="cohortOptions()" [value]="store.cohort() ?? ''" (valueChange)="store.cohort.set($event)" />
 *
 * demo: today's markup (select.select, the selected option marked per option); host display: contents, so a
 * wrapping <label> still labels the native select. sbb: sbb-select in sbb-form-field (select.md), options in
 * the same order; only a user's pick (selectionChange) is passed on.
 */
@Component({
  selector: 'ui-select',
  imports: [SbbFormField, SbbSelect, SbbOption, UiSbbIcons],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (sbb()) {
      @defer (on immediate) {
        <ui-sbb-icons />
        <sbb-form-field [class]="'ui-sbb-field ' + extraClass()">
          <sbb-select [value]="value() ?? ''" [aria-label]="ariaLabel() ?? ''" (selectionChange)="valueChange.emit($event.value)">
            @for (o of options(); track $index) {
              <sbb-option [value]="o.value">{{ o.label }}</sbb-option>
            }
          </sbb-select>
        </sbb-form-field>
      }
    } @else {
      <select [class]="selectClass()" [attr.id]="selectId()" [attr.aria-label]="ariaLabel()" (change)="valueChange.emit($any($event.target).value)">
        @for (o of options(); track $index) {
          <option [value]="o.value" [selected]="o.value === (value() ?? '')">{{ o.label }}</option>
        }
      </select>
    }
  `,
})
export class UiSelect {
  private readonly style = inject(StyleService);

  readonly options = input.required<readonly UiSelectOption[]>();
  readonly value = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  /** extra classes next to `select` (demo) / on the form field (sbb) */
  readonly extraClass = input('');
  readonly selectId = input<string | null>(null);
  readonly valueChange = output<string>();

  protected readonly sbb = computed(() => this.style.variant() === 'sbb');
  protected readonly selectClass = computed(() => ('select ' + this.extraClass()).trim());
}
