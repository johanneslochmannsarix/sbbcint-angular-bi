import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, inject } from '@angular/core';
import { StoryService } from '../../story/story';
import { ENVS, Env } from '../../core/api';
import { HeaderSlot } from '../../core/header-slot';
import { dateOnly, dateTimeLU, localMs } from '../../core/format';
import { UiButton, UiOption, UiSelect, UiSelectOption, UiSeg } from '../../shared/ui';
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
  imports: [HeaderSlot, UiSeg, UiSelect, UiButton, KpiBand, OverviewView, TaetigkeitenView, TourDrillView, PersonaltypenView, PlanJupView, PlanIstView, AenderungenView, AngerechnetView],
  providers: [Ac4Store],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ac4.css',
  host: { class: 'ac4' },
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title ac4-title">FiCo Produktivität</span>
        <ui-seg ariaLabel="Umgebung" [options]="envOptions" [value]="store.env()" (valueChange)="store.setEnv($event)" />
        <ui-seg size="sm" ariaLabel="Planmonat" [options]="monthOptions()" [value]="store.month()" (valueChange)="store.pickMonth($event)" />
        <div class="asof" title="sm_fico hat keinen eigenen Datenstand: jüngste rückgemeldete Ist-Zeit eines Tourelements und das Planfenster">
          <span class="asof-label">Stand</span>
          <span class="asof-value">{{ asOf() }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template appHeader="sub">
      <nav class="sel-bar ac4-crumbs" aria-label="Drill-Pfad">
        <ui-button kind="ghost" extraClass="ac4-back" (click)="store.back()" [disabled]="!canBack()" label="Eine Ebene zurück">‹ Zurück</ui-button>
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
          <ui-select [options]="ptypOptions()" [value]="ptypValue()" (valueChange)="setPtyp($event)" />
        </label>
        <label class="ac4-field">Tätigkeit
          <ui-select [options]="taetOptions()" [value]="store.taet() ?? ''" (valueChange)="setTaet($event)" />
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
  protected readonly envOptions: UiOption<Env>[] = ENVS.map((e) => ({ value: e, label: e }));
  /** «alle» + the plan months; an incomplete month carries its reason as title and the ac4-inc mark */
  protected readonly monthOptions = computed<UiOption<string | null>[]>(() => [
    { value: null, label: 'alle' },
    ...this.store.monthsAll().map((m) => ({ value: m, label: monthLabel(m), title: this.store.incomplete(m) ?? '', cls: this.store.incomplete(m) ? 'ac4-inc' : undefined })),
  ]);
  protected readonly ptypOptions = computed<UiSelectOption[]>(() => [
    { value: '', label: 'alle' },
    ...this.store.ptyps().map((p) => ({ value: String(p.rang), label: p.label ?? '' })),
  ]);
  protected readonly ptypValue = computed(() => String(this.store.ptyp() ?? ''));
  protected readonly taetOptions = computed<UiSelectOption[]>(() => [
    { value: '', label: 'alle' },
    ...this.store.taets().map((t) => ({ value: t.key, label: t.label ?? '' })),
  ]);

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
