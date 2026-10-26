import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, effect, inject } from '@angular/core';
import { HeaderSlot } from '../../core/header-slot';
import { Env } from '../../core/api';
import { UiButton, UiOption, UiSelect, UiSelectOption, UiSeg } from '../../shared/ui';
import { StoryService } from '../../story/story';
import { BLANK, dateTimeLU, localMs, num, utcMs } from '../../core/format';
import { Ac9Store, monthLabel } from './data/store';
import { RULES } from './data/rules';
import { GaCode, KATS, KatCode } from './data/types';
import { AuftragDrill } from './views/auftrag-drill';
import { Beleg } from './views/beleg';
import { IstPlan } from './views/ist-plan';
import { MonthBar } from './views/month-bar';
import { PersonDrill } from './views/person-drill';
import { Portfolio } from './views/portfolio';
import { Quote } from './views/quote';
import { Schwellen } from './views/schwellen';
import { TourDrill } from './views/tour-drill';
import { Trend } from './views/trend';

/**
 * AC-9 Rechnungslegung RT&S (sm_rechnungslegung_rts). LOCAL ONLY, masked by default: order names and Tournummern
 * are T-… tokens, tours D-… pseudo-ids, the one person column P-…; no name or personnel number is ever read.
 * The month's billing story from the portfolio down to one tour, with the billing rules as footnotes
 * (backend/queries/ac9/README.md). One Ac9Store, backed by the URL: the month bar picks the months, AÜ / DL and
 * International filter, the portfolio opens an order, a tour list row or a point opens a tour, the tour's person
 * opens the person; breadcrumb and browser back walk it.
 */
@Component({
  selector: 'app-ac9-page',
  imports: [HeaderSlot, UiSeg, UiButton, UiSelect, MonthBar, Beleg, Portfolio, Trend, Quote, IstPlan, Schwellen, AuftragDrill, TourDrill, PersonDrill],
  providers: [Ac9Store],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ac9.css',
  host: { class: 'ac9' },
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title ac9-title">Rechnungslegung RT&amp;S</span>
        <ui-seg ariaLabel="Umgebung" [options]="envOptions" [value]="store.env()" (valueChange)="store.setEnv($event)" />
        <div class="asof" title="Gold-Schreibzeit der Tourtabelle (UTC) und jüngstes zurückgemeldetes IST-Ende">
          <span class="asof-label">Stand</span>
          <span class="asof-value">{{ asOf() }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template appHeader="sub">
      <nav class="sel-bar ac9-crumbs" aria-label="Drill-Pfad und Filter">
        <ui-button kind="ghost" (click)="store.back()" [disabled]="!store.auftrag() && !store.tour() && !store.person()" label="Eine Ebene zurück">‹ Zurück</ui-button>
        <button type="button" class="linkish" (click)="store.openAuftrag(null)">Alle Aufträge</button>
        @if (store.auftrag()) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.openAuftrag(store.auftrag())">{{ store.orderLabel() }}</button>
        }
        @if (store.tour(); as t) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.openTour(t)">Tour {{ store.tourKopf.rows()[0]?.tourbezeichnung ?? t }}</button>
        }
        @if (store.person(); as p) {
          <span aria-hidden="true">›</span><span>{{ p }}</span>
        }
        <span class="ac9-gap"></span>
        <ui-seg size="sm" ariaLabel="Geschäftsart" [options]="gaOptions" [value]="store.ga()" (valueChange)="store.setGa($event)" />
        <label class="field-custom field">
          <span class="field-label">Kategorie des Auftrags</span>
          <ui-select [options]="katOptions" [value]="store.kat() ?? ''" (valueChange)="setKat($event)" />
        </label>
        @if (store.ga() || store.kat() || store.auftrag()) {
          <button type="button" class="linkish" (click)="store.clearAll()">Alles aufheben</button>
        }
      </nav>
    </ng-template>

    <div class="page">
      <header class="ac9-lede">
        <h1 class="ac9-h1">{{ headline() }}</h1>
        <p class="ac9-dek">Was RT&amp;S für Dienstleistung und Arbeitnehmerüberlassung in Rechnung stellen kann, aus den zurückgemeldeten IST-Zeiten des Modells sm_rechnungslegung_rts: vom Monat über den Auftrag bis zur einzelnen Tour.</p>
      </header>
      @if (store.echoMismatch()) {
        <p class="ac9-warn" role="status"><span class="status-icon status-serious" aria-hidden="true"></span>Das Modell wurde seit dem Laden der Auftragsliste aktualisiert: der gewählte Auftrag passt nicht mehr sicher. Auftrag bitte neu wählen.</p>
      }
      <ac9-month-bar />
      <ac9-beleg />
      @if (store.auftrag()) { <ac9-auftrag-drill id="ac9-auftrag" /> }
      @if (store.tour()) { <ac9-tour-drill id="ac9-tour" /> }
      @if (store.person()) { <ac9-person-drill id="ac9-person" /> }
      <section class="ac9-row ac9-row-2">
        <ac9-portfolio />
        <ac9-trend />
      </section>
      <section class="ac9-row ac9-row-2">
        <ac9-quote />
        <ac9-schwellen />
      </section>
      <ac9-ist-plan />
      <footer class="card ac9-foot">
        <div>
          <h2>Stand und Umfang</h2>
          <p>Daten: {{ asOfLong() }}.</p>
          <p>Mindestabnahme nicht modelliert: sie ist je Kunde und je Mitarbeiter/in vereinbart und bleibt in der Excel von Finance. Rundung, Überzeit-Bewertung und Preise ebenso.</p>
          <p>Lieferobjekte: der Monatsbericht «Rechnungslegung-RTS» (paginiert) und der Bericht «Rechnungslegung RT&amp;S – Übersicht», beide in RTS QA. Diese Ansicht liest dasselbe Modell, nur lesend.</p>
        </div>
        <div>
          <h2>Regeln (M. Ludwig, 08.10.2026)</h2>
          <ol>
            @for (r of rules; track r.n) { <li>{{ r.text }}</li> }
          </ol>
        </div>
      </footer>
    </div>
  `,
})
export class Ac9Page {
  protected readonly store = inject(Ac9Store);
  protected readonly rules = RULES;
  protected readonly kats = KATS;
  protected readonly envOptions: UiOption<Env>[] = this.store.envs.map((e) => ({ value: e, label: e }));
  protected readonly gaOptions: UiOption<GaCode | null>[] = [
    { value: null, label: 'AÜ und DL' },
    { value: 'AUE', label: 'AÜ' },
    { value: 'DL', label: 'DL' },
  ];
  protected readonly katOptions: UiSelectOption[] = [{ value: '', label: 'alle' }, ...KATS.map((k) => ({ value: k.code, label: k.label }))];

  protected readonly headline = computed(() => {
    const where = this.store.auftrag() ? (this.store.orderLabel() ?? 'Auftrag') : 'Alle Aufträge';
    return `${where}, ${this.store.rangeTextLong()}`;
  });
  protected readonly asOf = computed(() => {
    const s = this.store.stand.rows()[0];
    if (!s) return '…';
    return `${dateTimeLU(utcMs(s.ingested_max))}, IST bis ${monthLabel(s.letzter_ist_monat)}`;
  });
  protected readonly asOfLong = computed(() => {
    const s = this.store.stand.rows()[0];
    if (!s) return BLANK;
    return `Modell geschrieben ${dateTimeLU(utcMs(s.ingested_max))}, jüngstes zurückgemeldetes IST-Ende ${dateTimeLU(localMs(s.ist_ende_max))}; ` +
      `${num(s.touren)} Touren (${num(s.touren_ist)} mit IST) auf ${num(s.auftraege)} Aufträgen, Abrechnungsmonate ${monthLabel(s.erster_ist_monat)} – ${monthLabel(s.letzter_ist_monat)}`;
  });

  constructor() {
    // shared story mode: the story drives this page through Ac9Store.storyFocus while it is shown
    inject(DestroyRef).onDestroy(inject(StoryService).register('ac9', this.store));
    // a drill opens below the statement: bring it into view once it is there
    let last = '';
    effect(() => {
      const target = this.store.person() ? 'ac9-person' : this.store.tour() ? 'ac9-tour' : this.store.auftrag() ? 'ac9-auftrag' : '';
      if (target && target !== last) setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      last = target;
    });
  }

  protected setKat(v: string): void {
    this.store.setKat((v || null) as KatCode | null);
  }
}
