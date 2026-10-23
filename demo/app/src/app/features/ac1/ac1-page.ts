import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { ENVS, Env } from '../../core/api';
import { dateLong, localStamp, monthLong } from '../../core/format';
import { HeaderSlot } from '../../core/header-slot';
import { QualLink } from '../../shared/qual-link';
import { StoryService } from '../../story/story';
import { AUDIENCES, AUDIENCE_LABEL, Audience } from './data/model';
import { Ac1Store, label } from './data/store';
import { CohortWeekView } from './views/cohort-week';
import { DayGanttView } from './views/day-gantt';
import { DayMapView } from './views/day-map';
import { MonthCalendarView } from './views/month-calendar';

/**
 * AC-1 Plantafel (RT&S, Ausbildungsabteilung), LOCAL-ONLY showcase. Drill-down month -> day -> person day,
 * from the Ausbilder or the Auszubildende side; «ansehen als» stands in for per-person access (no auth here).
 * Plan times only. Calendar periods (dim_date), never the month parsed from the order name.
 */
@Component({
  selector: 'app-ac1-page',
  imports: [HeaderSlot, QualLink, MonthCalendarView, DayGanttView, DayMapView, CohortWeekView],
  providers: [Ac1Store],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title">Plantafel RT&amp;S</span>
        <div class="seg" role="group" aria-label="Umgebung">
          @for (e of envs; track e) {
            <button type="button" [attr.aria-pressed]="store.env() === e" (click)="setEnv(e)">{{ e }}</button>
          }
        </div>
        <div class="seg" role="group" aria-label="Ansehen als">
          @for (a of audiences; track a) {
            <button type="button" [attr.aria-pressed]="store.audience() === a" (click)="store.setAudience(a)">{{ audienceLabel[a] }}</button>
          }
        </div>
        <label class="as-person">
          <span class="field-label">ansehen als</span>
          <select class="select" (change)="store.person.set($any($event.target).value)" aria-label="Person">
            @for (p of store.audienceList(); track p.person.key) {
              <!-- [selected] per option: the select's own [value] binds before a new audience's options exist -->
              <option [value]="p.person.key" [selected]="p.person.key === store.person()">{{ text(p.person) }}{{ p.tourDays ? '' : ' (ohne Plan)' }}</option>
            }
          </select>
        </label>
        <div class="asof" title="Datenstand des Modells (agg_pipeline_datenstand)">
          <span class="asof-label">Datenstand</span>
          <span class="asof-value">{{ asOf() }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template appHeader="sub">
      <nav class="sel-bar trail" aria-label="Auswahl">
        <span class="sel-chip">{{ monthText() }}</span>
        @if (store.day(); as d) {
          <span class="trail-sep" aria-hidden="true">›</span>
          <span class="sel-chip">{{ dayText(d) }}
            <button type="button" class="chip-x" (click)="store.day.set(null)" aria-label="Tag abwählen">×</button></span>
        }
        @if (store.focus(); as f) {
          <span class="trail-sep" aria-hidden="true">›</span>
          <span class="sel-chip">{{ audienceLabel[store.audience()] }} {{ text(f.person) }}</span>
          <app-qual-link [person]="f.person.key" tenant="RTS" [env]="store.env()" />
        }
        <span class="sel-note">Nur Planzeiten. Personen pseudonymisiert, solange das Backend nicht mit -Real läuft.</span>
      </nav>
    </ng-template>

    <div class="page">
      <section class="ac1-top">
        <ac1-month-calendar />
        <ac1-cohort-week />
      </section>
      <ac1-day-gantt />
      <ac1-day-map />
    </div>
  `,
  styles: [`
    .ac1-top { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .as-person { display: inline-flex; align-items: center; gap: 6px; }
    .trail { gap: 6px; }
    .trail-sep { color: var(--muted); }
    @media (max-width: 1100px) { .ac1-top { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class Ac1Page {
  protected readonly store = inject(Ac1Store);
  protected readonly envs = ENVS;
  protected readonly audiences = AUDIENCES;
  protected readonly audienceLabel = AUDIENCE_LABEL;
  protected readonly text = label;

  protected readonly asOf = computed(() => localStamp(this.store.asOf.rows()[0]?.datenstand_local ?? null));
  protected readonly monthText = computed(() => monthLong(this.store.month()));

  constructor() {
    // shared story mode (D2): the story reads and sets this page's state while the page is shown
    inject(DestroyRef).onDestroy(inject(StoryService).register('ac1', this.store));
  }

  protected dayText(d: number): string {
    return dateLong(d);
  }

  protected setEnv(e: Env): void {
    if (e === this.store.env()) return;
    // pseudonyms are per backend process, the same in both envs; the person may not exist in the other env
    this.store.env.set(e);
  }

  protected setAudience(a: Audience): void {
    this.store.setAudience(a);
  }
}
