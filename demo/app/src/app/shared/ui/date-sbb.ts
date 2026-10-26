import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { provideNativeDateAdapter } from '@sbb-esta/angular/core';
import { SBB_DATEPICKER_SCROLL_STRATEGY_FACTORY_PROVIDER, SbbDateInput, SbbDatepicker } from '@sbb-esta/angular/datepicker';
import { SbbFormField } from '@sbb-esta/angular/form-field';
import { SbbInput } from '@sbb-esta/angular/input';
import { UiSbbIcons } from './sbb-icons';

/** «yyyy-mm-dd» of a local date (datepicker.md: send only the date part, built from the local fields). */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The sbb branch of ui-date (date.ts), its own file so `@defer` can load it lazily. The standalone datepicker
 * classes need what SbbDatepickerModule provides (fesm2022/datepicker.mjs: the scroll strategy and the native date
 * adapter, the default per datepicker.md); provided here instead of importing the module.
 */
@Component({
  selector: 'ui-date-sbb',
  imports: [SbbDatepicker, SbbDateInput, SbbFormField, SbbInput, UiSbbIcons],
  providers: [SBB_DATEPICKER_SCROLL_STRATEGY_FACTORY_PROVIDER, provideNativeDateAdapter()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <ui-sbb-icons />
    <sbb-form-field class="ui-sbb-field">
      <sbb-datepicker>
        <input sbbDateInput sbbInput [attr.id]="inputId()" [value]="asDate()" (dateChange)="fromPicker($event.value)" />
      </sbb-datepicker>
    </sbb-form-field>
  `,
})
export class UiDateSbb {
  readonly value = input('');
  readonly inputId = input<string | null>(null);
  readonly valueChange = output<string>();

  protected readonly asDate = computed(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(this.value());
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  });

  protected fromPicker(d: Date | null): void {
    this.valueChange.emit(d ? isoDay(d) : '');
  }
}
