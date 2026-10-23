import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DataStore } from '../data/model';
import { ThemeService } from '../data/theme';
import { num } from '../../../core/format';
import { STATUS_ORDER } from '../data/tokens';

/** The Übersicht cards, kept as numbers (they are the headline), plus the people count. Report reference values. */
@Component({
  selector: 'app-kpis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'card card-flat kpis' },
  template: `
    <div class="tile-row tile-row-7">
      <div class="tile">
        <span class="tile-label">Personen</span>
        <span class="tile-value">{{ people() }}</span>
        @if (noName()) { <span class="tile-foot">{{ noName() }} ohne Namen</span> }
      </div>
      @for (s of tiles(); track s.code) {
        <div class="tile">
          <span class="tile-label"><i class="key" [class.ring]="s.code === 'DATES_MISSING'" [style.background]="s.color" [style.border-color]="tokens().ring"></i>{{ s.label }}</span>
          <span class="tile-value">{{ s.value }}</span>
        </div>
      }
    </div>
  `,
})
export class KpisView {
  private readonly store = inject(DataStore);
  protected readonly tokens = inject(ThemeService).tokens;

  protected readonly people = computed(() => num(this.store.model()?.persons.length));
  protected readonly noName = computed(() => (this.store.model()?.noName ? num(this.store.model()!.noName) : ''));
  protected readonly tiles = computed(() => {
    const t = this.store.totals();
    const labels = this.store.statusLabel();
    const tok = this.tokens();
    const ready = !!this.store.sbq.result();
    return STATUS_ORDER.map((code) => ({
      code, label: labels[code], value: ready ? num(t[code]) : '–',
      color: code === 'MISSING_NEVER' ? tok.noName : tok.status[code],
    }));
  });
}
