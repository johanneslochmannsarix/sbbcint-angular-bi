import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, inject } from '@angular/core';
import { ENVS, Env } from '../../core/api';
import { HeaderSlot } from '../../core/header-slot';
import { dateShort, dateTimeLU, dayMs, localMs } from '../../core/format';
import { PseudonymChip } from '../../shared/pseudonym-chip';
import { QualLink } from '../../shared/qual-link';
import { StoryService } from '../../story/story';
import { Ac8Store, WORKER_LABEL, Worker } from './data/store';
import { AbsenceCalendar } from './views/absence-calendar';
import { DienstplanDiff } from './views/dienstplan-diff';
import { KpiStrip } from './views/kpi-strip';
import { LeadtimeView } from './views/leadtime';
import { PipelineView } from './views/pipeline';
import { RiverView } from './views/river';
import { Schichtuhr } from './views/schichtuhr';
import { ShiftDrawer } from './views/shift-drawer';
import { StoryBar } from './views/story-bar';
import { VersionTimeline } from './views/version-timeline';

/**
 * AC-8 Leitstand Leitstelle Olten (PLAN §13, built in the demo app per §14). LOCAL ONLY, masked by default.
 * Every view answers a Leitstelle question (backend/queries/ac8/README.md); all share one selection
 * (Ac8Store): KPI tile / pipeline node -> focus, scatter brush -> pipeline + river, a shift -> its versions,
 * a person -> highlighted in the duty-plan diff, a story week -> every view.
 */
@Component({
  selector: 'app-ac8-page',
  imports: [HeaderSlot, PseudonymChip, QualLink, KpiStrip, StoryBar, Schichtuhr, PipelineView, RiverView, LeadtimeView, DienstplanDiff, VersionTimeline, AbsenceCalendar, ShiftDrawer],
  providers: [Ac8Store],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ac8.css',
  host: { class: 'ac8' },
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title ac8-title">Leitstand Olten</span>
        <div class="seg" role="group" aria-label="Umgebung">
          @for (e of envs; track e) {
            <button type="button" [attr.aria-pressed]="store.env() === e" (click)="setEnv(e)">{{ e }}</button>
          }
        </div>
        <div class="seg seg-sm" role="group" aria-label="Zeitfenster">
          <button type="button" [attr.aria-pressed]="span() === '4+8'" (click)="store.setWindowWeeks(4, 8)">−4 / +8 Wochen</button>
          <button type="button" [attr.aria-pressed]="span() === '0+4'" (click)="store.setWindowWeeks(0, 4)">nächste 4 Wochen</button>
          <button type="button" [attr.aria-pressed]="span() === 'plan'" (click)="store.setWholePlan()">ganzer Plan</button>
        </div>
        <div class="seg seg-sm" role="group" aria-label="Personaltyp">
          @for (w of workers; track w) {
            <button type="button" [attr.aria-pressed]="store.worker() === w" (click)="store.worker.set(w)">{{ workerLabel(w) }}</button>
          }
        </div>
        <div class="asof" title="Jüngste Version im Modell (fact_shift_snapshot created_ts); das Modell hat keinen eigenen Datenstand">
          <span class="asof-label">Stand</span>
          <span class="asof-value">{{ asOf() }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template appHeader="sub">
      <div class="sel-bar" role="status">
        <span class="sel-note">{{ windowText() }}</span>
        @if (store.focus(); as f) {
          <span class="sel-chip">Fokus: {{ f }} <button type="button" class="chip-x" (click)="store.focus.set(null)" aria-label="Fokus aufheben">×</button></span>
        }
        @if (store.brush(); as b) {
          <span class="sel-chip">Vorlauf {{ b.leadMin }}…{{ b.leadMax }} h, erstellt {{ short(b.from) }}–{{ short(b.to) }}
            <button type="button" class="chip-x" (click)="store.brush.set(null)" aria-label="Auswahl der Vorlaufzeit aufheben">×</button></span>
        }
        @if (store.person$(store.person()); as p) {
          <span class="sel-chip">Person <app-pseudonym [person]="p" /> <app-qual-link [person]="p.key" tenant="CARGOCONTROL" [env]="store.env()" /> <button type="button" class="chip-x" (click)="store.person.set(null)" aria-label="Person abwählen">×</button></span>
        }
        @if (store.focus() || store.brush() || store.person()) {
          <button type="button" class="linkish" (click)="store.clearSelection()">Alles aufheben</button>
        }
      </div>
    </ng-template>

    <div class="page ac8-page">
      <ac8-kpi-strip />
      <ac8-story-bar />
      <ac8-schichtuhr />
      <section class="ac8-pair">
        <ac8-pipeline />
        <ac8-river />
      </section>
      <ac8-leadtime />
      <ac8-dienstplan-diff />
      <section class="ac8-pair ac8-pair-wide">
        <ac8-version-timeline />
        <ac8-absence-calendar />
      </section>
    </div>

    @if (store.flow()) {
      <div class="scrim" (click)="store.flow.set(null)" aria-hidden="true"></div>
      <ac8-shift-drawer />
    }
  `,
})
export class Ac8Page {
  protected readonly store = inject(Ac8Store);
  protected readonly envs = ENVS;
  protected readonly workers: Worker[] = ['disponent', 'andere', 'alle'];
  protected readonly workerLabel = (w: Worker) => WORKER_LABEL[w];
  protected readonly short = (iso: string) => dateShort(dayMs(iso)!);

  protected readonly asOf = computed(() => dateTimeLU(localMs(this.store.stand.rows()[0]?.neuester_stand ?? null)));
  protected readonly span = computed(() => {
    const days = (dayMs(this.store.to())! - dayMs(this.store.from())!) / 86_400_000;
    const s = this.store.stand.rows()[0];
    if (s?.erster_plantag && this.store.to() >= (s.letzter_plantag ?? '').slice(0, 10) && days > 100) return 'plan';
    return days > 60 ? '4+8' : '0+4';
  });
  protected readonly windowText = computed(() => `Planungstage ${this.short(this.store.from())} bis ${this.short(this.store.to())}, ${WORKER_LABEL[this.store.worker()]}`);

  constructor() {
    // shared story mode (D2): the story reads and sets this page's state while the page is shown
    inject(DestroyRef).onDestroy(inject(StoryService).register('ac8', this.store));
  }

  protected setEnv(e: Env): void {
    this.store.env.set(e);
    this.store.clearSelection();
    this.store.shift.set(null);
    this.store.resetStory();
  }
}
