import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RULES } from '../data/rules';

/**
 * The rule line at the foot of a card: the footnote numbers of the billing rules that shape it, and the short
 * rule text. The same numbers stand in the footer list (the invoice's small print).
 */
@Component({
  selector: 'ac9-rule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ac9-rule' },
  template: `
    @for (r of rules(); track r.n) {
      <p><sup class="ac9-fn">{{ r.n }}</sup>{{ r.text }}</p>
    }
    <ng-content />
  `,
})
export class RuleNote {
  readonly keys = input.required<string[]>();
  protected readonly rules = computed(() => RULES.filter((r) => this.keys().includes(r.key)));
}
