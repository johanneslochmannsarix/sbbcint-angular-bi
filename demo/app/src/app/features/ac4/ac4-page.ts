import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, inject } from '@angular/core';
import { StoryService } from '../../story/story';
import { ENVS } from '../../core/api';
import { HeaderSlot } from '../../core/header-slot';
import { dateOnly, dateTimeLU, localMs } from '../../core/format';
import { Ac4Store, monthLabel } from './data/store';
import { AenderungenView } from './views/aenderungen';
import { AngerechnetView } from './views/angerechnet';
import { KpiBand } from './views/kpi-band';
import { OverviewView } from './views/overview';
import { PersonaltypenView } from './views/personaltypen';
import { PlanIstView } from './views/plan-ist';
import { PlanJupView } from './views/plan-jup';
import { TaetigkeitenView } from './views/taetigkeiten';
import { TourDrillView } from './views/tour-drill';

/**
 * AC-4 FiCo Produktivität CargoControl (sm_fico). LOCAL ONLY, masked by default (the only free text, the tour
 * name, is a token; no person column is ever read). Every view answers a controller question
 * (backend/queries/ac4/README.md); all share one Ac4Store: KPI month column -> month, treemap / ranking ->
 * Firma / Tourstandort, Tätigkeit bar -> Tätigkeit, Personaltyp bar -> Personaltyp, calendar day -> month,
 * scatter point -> its tour. The breadcrumb walks the drill path back.
 */
@Component({
  selector: 'app-ac4-page',
  imports: [HeaderSlot, KpiBand, OverviewView, TaetigkeitenView, TourDrillView, PersonaltypenView, PlanJupView, PlanIstView, AenderungenView, AngerechnetView],
  providers: [Ac4Store],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ac4.css',
  host: { class: 'ac4' },
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title ac4-title">FiCo Produktivität</span>
        <div class="seg" role="group" aria-label="Umgebung">
          @for (e of envs; track e) {
            <button type="button" [attr.aria-pressed]="store.env() === e" (click)="store.setEnv(e)">{{ e }}</button>
          }
        </div>
        <div class="seg seg-sm" role="group" aria-label="Planmonat">
          <button type="button" [attr.aria-pressed]="!store.month()" (click)="store.pickMonth(null)">alle</button>
          @for (m of store.monthsAll(); track m) {
            <button type="button" [attr.aria-pressed]="store.month() === m" (click)="store.pickMonth(m)"
                    [title]="store.incomplete(m) ?? ''" [class.ac4-inc]="!!store.incomplete(m)">{{ label(m) }}</button>
          }
        </div>
        <div class="asof" title="sm_fico hat keinen eigenen Datenstand: jüngste rückgemeldete Ist-Zeit eines Tourelements und das Planfenster">
          <span class="asof-label">Stand</span>
          <span class="asof-value">{{ asOf() }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template appHeader="sub">
      <nav class="sel-bar ac4-crumbs" aria-label="Drill-Pfad">
        <button type="button" class="btn btn-ghost ac4-back" (click)="store.back()" [disabled]="!canBack()" aria-label="Eine Ebene zurück">‹ Zurück</button>
        <button type="button" class="linkish" (click)="store.pickFirma(null); store.pickStandort(null)">Alle Firmen</button>
        @if (store.firma(); as f) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.pickStandort(null)">{{ f }}</button>
        }
        @if (store.standortName(); as s) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.tour.set(null)">{{ s }}</button>
        }
        @if (store.tour()) {
          <span aria-hidden="true">›</span>
          <span>Tour</span>
        }
        <span class="ac4-crumb-gap"></span>
        <label class="ac4-field">Personaltyp Tour
          <select class="select" [value]="store.ptyp() ?? ''" (change)="setPtyp($any($event.target).value)">
            <option value="">alle</option>
            @for (p of store.ptyps(); track p.key) { <option [value]="p.rang">{{ p.label }}</option> }
          </select>
        </label>
        <label class="ac4-field">Tätigkeit
          <select class="select" [value]="store.taet() ?? ''" (change)="setTaet($any($event.target).value)">
            <option value="">alle</option>
            @for (t of store.taets(); track t.key) { <option [value]="t.key">{{ t.label }}</option> }
          </select>
        </label>
        @if (store.firma() || store.standort() || store.ptyp() != null || store.taet() || store.tour()) {
          <button type="button" class="linkish" (click)="store.clearAll()">Alles aufheben</button>
        }
      </nav>
    </ng-template>

    <div class="page ac4-page">
      <header class="ac4-lede">
        <h1 class="ac4-h1">{{ headline() }}</h1>
        <p class="ac4-dek">Planvolumen der Touren, Fahranteil und Ist-Erfassung aus dem Modell sm_fico, Firma für Firma bis zur einzelnen Tour. Alle Stunden sind Planwerte der Disposition, ausser wo «Ist» steht.</p>
      </header>
      <ac4-kpi-band />
      <section class="ac4-row ac4-row-main">
        <ac4-overview />
        <ac4-taetigkeiten />
      </section>
      <ac4-tour-drill />
      <ac4-personaltypen />
      <ac4-plan-ist />
      <ac4-aenderungen />
      <section class="ac4-row ac4-row-even">
        <ac4-plan-jup />
        <ac4-angerechnet />
      </section>
      <p class="ac4-foot">Keine Auftragssicht: der Weg vom Fahrelement zum Auftrag erreicht 2,4 % der Fahrelemente und ab Oktober keines (SAX-47). Kilometer und Personalkosten liefert der Export nicht. Der Bericht exportiert nur zusammengefasste Daten; diese Demo bietet keinen Zeilen-Download.</p>
    </div>
  `,
})
export class Ac4Page {
  protected readonly store = inject(Ac4Store);
  protected readonly envs = ENVS;
  protected readonly label = (m: string) => monthLabel(m);

  protected readonly asOf = computed(() => {
    const s = this.store.stand.rows()[0];
    if (!s) return '…';
    return `Ist bis ${dateTimeLU(localMs(s.juengstes_ist))} · Plan ${dateOnly(s.erster_plantag)} – ${dateOnly(s.letzter_plantag)}`;
  });
  protected readonly canBack = computed(() => !!(this.store.tour() || this.store.standort() || this.store.firma()));
  protected readonly headline = computed(() => {
    const where = this.store.standortName() ?? this.store.firma() ?? 'Alle Tourstandorte';
    return `${where}, ${this.store.month() ? monthLabel(this.store.month()) : 'ganzes Planfenster'}`;
  });

  constructor() {
    // shared story mode: the story reads and sets this page's state while the page is shown
    inject(DestroyRef).onDestroy(inject(StoryService).register('ac4', this.store));
  }

  protected setPtyp(v: string): void {
    this.store.ptyp.set(v ? Number(v) : null);
    this.store.tour.set(null);
  }
  protected setTaet(v: string): void {
    this.store.taet.set(v || null);
    this.store.tour.set(null);
  }
}
