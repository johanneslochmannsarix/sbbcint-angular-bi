import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LoadState } from '../core/query';

/**
 * A titled panel around one chart or table. The projected body is always in the DOM (echarts needs a
 * sized element); loading / error / empty are an overlay on top of it. While a new request loads, the
 * previous render stays visible, dimmed: no skeleton flash on refetch. Empty means "no rows under this
 * filter", not "no data".
 */
@Component({
  selector: 'app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'card', '[class.is-stale]': 'stale()', '[attr.aria-busy]': 'loading()' },
  template: `
    <header class="card-head">
      <div>
        <h2>{{ heading() }}</h2>
        @if (sub()) {
          <p class="card-sub">{{ sub() }}</p>
        }
      </div>
      <ng-content select="[card-tools]" />
    </header>
    <div class="card-body">
      <ng-content />
      @if (error(); as e) {
        <div class="state state-error" role="alert">
          <p class="state-title">
            <span class="status-icon status-critical" aria-hidden="true"></span>
            {{ errorTitle() }}
          </p>
          <p class="state-msg">{{ e.message }}</p>
          @if (e.retryAfterS) {
            <p class="state-msg">Das Abfragelimit dieses Backends ist erreicht. In {{ e.retryAfterS }} s erneut versuchen.</p>
          }
          <button type="button" class="btn" (click)="retryAll()">Erneut versuchen</button>
        </div>
      } @else if (firstLoad()) {
        <div class="state state-loading"><span class="spinner" aria-hidden="true"></span>Lädt</div>
      } @else if (idle()) {
        <div class="state state-empty"><p>{{ idleText() }}</p></div>
      } @else if (empty()) {
        <div class="state state-empty">
          <p class="state-title">Keine Zeilen unter diesem Filter.</p>
          @if (emptyNote()) {
            <p class="state-msg">{{ emptyNote() }}</p>
          }
        </div>
      }
      @if (stale()) {
        <div class="stale-bar" aria-hidden="true"></div>
      }
    </div>
  `,
})
export class ChartCard {
  readonly heading = input.required<string>();
  readonly sub = input<string>('');
  /** One or more queries this panel depends on; the panel is empty only if the primary (first) is. */
  readonly q = input.required<LoadState<unknown> | LoadState<unknown>[]>();
  readonly emptyNote = input<string>('');
  readonly idleText = input<string>('Nichts ausgewählt.');
  /** Lets a page say "empty" for a reason the query cannot see (e.g. a client-side filter). */
  readonly forceEmpty = input<boolean>(false);

  private readonly list = computed(() => {
    const v = this.q();
    return Array.isArray(v) ? v : [v];
  });
  readonly error = computed(() => this.list().map((s) => s.error()).find((e) => e) ?? null);
  readonly loading = computed(() => this.list().some((s) => s.loading()));
  readonly stale = computed(() => this.list().some((s) => s.stale()));
  readonly firstLoad = computed(() => this.list().some((s) => s.loading() && !s.result()));
  readonly idle = computed(() => this.list()[0].idle());
  readonly empty = computed(() => this.list()[0].empty() || (this.forceEmpty() && !this.loading() && !this.error()));
  readonly errorTitle = computed(() => {
    const s = this.error()?.status;
    if (s === 400) return 'Das Backend hat die Anfrage abgelehnt (400)';
    if (s === 403) return 'Ausserhalb des erlaubten Bereichs (403)';
    if (s === 429) return 'Abfragelimit erreicht (429)';
    if (s === 502) return 'Fabric hat einen Fehler gemeldet (502)';
    if (s === 404) return 'Unbekannte Abfrage (404)';
    if (s === 0) return 'Backend nicht erreichbar';
    return `Anfrage fehlgeschlagen (${s})`;
  });

  retryAll(): void {
    for (const s of this.list()) if (s.error()) s.retry();
  }
}
