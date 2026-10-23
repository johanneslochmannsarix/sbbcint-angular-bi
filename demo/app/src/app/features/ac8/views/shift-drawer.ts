import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BLANK, dateOnly, dayMs, localMs, num, timeLocal } from '../../../core/format';
import { PseudonymChip } from '../../../shared/pseudonym-chip';
import { QualLink } from '../../../shared/qual-link';
import { quelleShort } from '../data/palette';
import { Ac8Store } from '../data/store';

const MAX = 400;

interface Line { sk: string; day: string; time: string; name: string; person: string | null; stand: string; rm: string }

/**
 * The shifts behind a pipeline flow (view 3), masked: person = pseudonym, shift name = text token unless the
 * backend runs with -Real. A listing of rows the backend already returned (shifts / dienstplan), filtered
 * to the flow, the story week and the scatter brush - no counting. Clicking a row opens its version timeline.
 */
@Component({
  selector: 'ac8-shift-drawer',
  imports: [PseudonymChip, QualLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'drawer', role: 'dialog', 'aria-modal': 'true', '[attr.aria-label]': 'flow()?.title' },
  template: `
    <header class="drawer-head">
      <div>
        <h2>{{ flow()?.title }}</h2>
        <p class="card-sub">{{ lines().length > max ? 'die ersten ' + max + ' von ' : '' }}{{ count() }} Schichten{{ scope() }}</p>
      </div>
      <button type="button" class="chip-x" (click)="store.flow.set(null)" aria-label="Liste schliessen">×</button>
    </header>
    <div class="drawer-body">
      <table class="tbl tbl-click">
        <thead><tr><th>Tag</th><th>Plan</th><th>Schicht</th><th>Person</th><th>Stand</th><th>Rückmeldung</th></tr></thead>
        <tbody>
          @for (l of shown(); track l.sk) {
            <tr (click)="open(l.sk)" tabindex="0" (keydown.enter)="open(l.sk)">
              <td>{{ l.day }}</td><td>{{ l.time }}</td><td>{{ l.name }}</td>
              <td>@if (store.person$(l.person); as p) { <app-pseudonym [person]="p" /> <app-qual-link [person]="p.key" tenant="CARGOCONTROL" [env]="store.env()" text="Quali ›" /> } @else { <span class="muted">unbesetzt</span> }</td>
              <td>{{ l.stand }}</td><td>{{ l.rm }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ShiftDrawer {
  protected readonly store = inject(Ac8Store);
  protected readonly max = MAX;
  protected readonly flow = this.store.flow;

  private readonly brushed = computed<Set<string> | null>(() => {
    const b = this.store.brush();
    if (!b) return null;
    const lo = dayMs(b.from)!;
    const hi = dayMs(b.to)! + 86_400_000;
    return new Set(this.store.versions.rows().filter((v) => {
      const c = localMs(v.created_ts);
      return c != null && c >= lo && c < hi && v.vorlauf_h != null && v.vorlauf_h >= b.leadMin && v.vorlauf_h <= b.leadMax;
    }).map((v) => v.shift_sk));
  });

  private inWeek(day: string): boolean {
    const w = this.store.storyWeek();
    return !w || (day >= w.from && day.slice(0, 10) <= w.to);
  }

  protected readonly lines = computed<Line[]>(() => {
    const f = this.flow();
    if (!f) return [];
    const b = this.brushed();
    const hm = (s: string | null, e: string | null) => {
      const a = localMs(s);
      const z = localMs(e);
      return a != null && z != null ? `${timeLocal(a)}–${timeLocal(z)}` : BLANK;
    };
    if (f.stand === 'gelöscht') {
      return this.store.dienstplan.rows()
        .filter((r) => r.dienstplan_quelle.startsWith('gelöscht') && this.inWeek(r.dienstplan_datum) && (!b || b.has(r.shift_sk)))
        .map((r) => ({ sk: r.shift_sk, day: dateOnly(r.dienstplan_datum), time: hm(r.dienstplan_start, r.dienstplan_ende), name: r.shift_name ?? BLANK,
          person: r.person_sk, stand: quelleShort(r.dienstplan_quelle), rm: r.rueckmeldung_status_label ?? BLANK }));
    }
    return this.store.shifts.rows()
      .filter((r) => (f.stand === '*' || r.kommunikationsstand === f.stand)
        && (f.rueckmeldung == null || (r.rueckmeldung_status_label ?? 'keine Rückmeldung') === f.rueckmeldung)
        && (f.weichtAb == null || !!r.weicht_von_juengstem_stand_ab === f.weichtAb)
        && this.inWeek(r.planned_date) && (!b || b.has(r.shift_sk)))
      .map((r) => ({ sk: r.shift_sk, day: dateOnly(r.planned_date), time: hm(r.planned_start, r.planned_end), name: r.shift_name ?? BLANK,
        person: r.person_sk, stand: r.kommunikationsstand, rm: r.rueckmeldung_status_label ?? BLANK }));
  });
  protected readonly shown = computed(() => this.lines().slice(0, MAX));
  protected readonly count = computed(() => num(this.lines().length));
  protected readonly scope = computed(() => {
    const w = this.store.storyWeek();
    return `${w ? `, ${w.label}` : ' im Fenster'}${this.store.brush() ? ', in der Auswahl der Vorlaufzeit' : ''}`;
  });

  protected open(sk: string): void {
    this.store.shift.set(sk);
    this.store.flow.set(null);
    document.getElementById('ac8-versionen')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
