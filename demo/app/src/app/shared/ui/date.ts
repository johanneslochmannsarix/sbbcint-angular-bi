import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { StyleService } from '../../core/style';
import { UiDateSbb } from './date-sbb';

/**
 * A date field with an «yyyy-mm-dd» string value (`input[type=date].select`).
 *
 * demo: today's markup (input type=date, emits on input); host display: contents. sbb: sbb-datepicker around an
 * sbbDateInput (date-sbb.ts, deferred), emits the picked day as «yyyy-mm-dd».
 */
@Component({
  selector: 'ui-date',
  imports: [UiDateSbb],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (sbb()) {
      @defer (on immediate) {
        <ui-date-sbb [value]="value()" [inputId]="inputId()" (valueChange)="valueChange.emit($event)" />
      }
    } @else {
      <input type="date" class="select" [attr.id]="inputId()" [value]="value()" (input)="valueChange.emit($any($event.target).value)" />
    }
  `,
})
export class UiDate {
  private readonly style = inject(StyleService);

  readonly value = input('');
  readonly inputId = input<string | null>(null);
  readonly valueChange = output<string>();

  protected readonly sbb = computed(() => this.style.variant() === 'sbb');
}
