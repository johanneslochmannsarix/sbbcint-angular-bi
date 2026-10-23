import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DataStore, DetailRow, label } from '../data/model';
import { createQuery } from '../data/query';
import { SelectionService } from '../data/selection';
import { ThemeService } from '../data/theme';
import { dateOnly, num } from '../../../core/format';
import { STATUS_ORDER } from '../data/tokens';

/**
 * One person, all qualifications: the table twin of a heatmap row (replaces one row of «Qualifikationsmatrix»
 * via the person slicer). Fetched server side with the pseudonym; the backend resolves it to the person key.
 */
@Component({
  selector: 'app-person-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'drawer', role: 'dialog', '[attr.aria-label]': '"Qualifikationen von " + title()', '(keydown.escape)': 'close()' },
  template: `
    <header class="drawer-head">
      <div>
        <h2>{{ title() }}</h2>
        <p class="card-sub">{{ meta() }}</p>
      </div>
      <button type="button" class="btn" (click)="close()" autofocus>Schliessen</button>
    </header>
    @if (detail.error(); as e) {
      <!-- a cross-link whose pseudonym this backend cannot resolve (400) ends here, never in a failure -->
      <p class="state-title drawer-pad">Keine Qualifikationsdaten</p>
      <p class="state-msg drawer-pad muted">{{ e.status === 400 ? 'Diese Person ist in diesem Modell nicht bekannt (oder das Backend wurde neu gestartet, Pseudonyme wechseln dann).' : e.message }}</p>
    } @else if (detail.loading() && !detail.result()) {
      <p class="muted drawer-pad"><span class="spinner"></span> Lädt</p>
    } @else {
      <div class="table-wrap drawer-body">
        <table class="tbl">
          <thead><tr><th>Qualifikation</th><th>Status</th><th>Gültig von</th><th>Gültig bis</th></tr></thead>
          <tbody>
            @for (r of rows(); track $index) {
              <tr [class.is-muted]="r.status_code === 'MISSING_NEVER'">
                <td class="wrap">{{ r.qualification_name }}</td>
                <td><i class="key" [class.ring]="r.status_code === 'DATES_MISSING'" [style.background]="tokens().status[r.status_code]" [style.border-color]="tokens().ring"></i>{{ statusLabel()[r.status_code] }}</td>
                <td>{{ r.status_code === 'DATES_MISSING' ? '∅' : dateOnly(r.valid_from) }}</td>
                <td>{{ r.status_code === 'DATES_MISSING' ? '∅' : dateOnly(r.valid_to) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="muted">Keine Qualifikationsdaten.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class PersonDrawer {
  private readonly store = inject(DataStore);
  private readonly sel = inject(SelectionService);
  protected readonly tokens = inject(ThemeService).tokens;
  protected readonly statusLabel = this.store.statusLabel;
  protected readonly dateOnly = dateOnly;

  protected readonly detail = createQuery<DetailRow>(() => {
    const p = this.sel.person();
    return p ? { name: 'person_detail', params: { ...this.store.base(), person: p } } : null;
  });
  private readonly person = computed(() => {
    const k = this.sel.person();
    return k ? (this.store.model()?.personByKey.get(k) ?? null) : null;
  });
  protected readonly title = computed(() => {
    const p = this.person();
    return p ? label(p, this.store.masked()) : (this.sel.person() ?? '');
  });
  protected readonly meta = computed(() => {
    const p = this.person();
    if (!p) return this.store.model() ? 'keine Qualifikationsdaten in diesem Modell' : '';
    const held = p.cells.size;
    return [p.org, `${held} gehalten, ${num(p.gaps)} fehlen`, p.expired ? `${p.expired} abgelaufen` : ''].filter(Boolean).join(', ');
  });
  protected readonly rows = computed(() =>
    [...this.detail.rows()].sort((a, b) => STATUS_ORDER.indexOf(a.status_code) - STATUS_ORDER.indexOf(b.status_code)
      || (a.qualification_name ?? '').localeCompare(b.qualification_name ?? '')));

  protected close(): void {
    this.sel.person.set(null);
  }
}
