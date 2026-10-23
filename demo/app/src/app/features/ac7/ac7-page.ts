import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import { ENVS } from '../../core/api';
import { HeaderSlot } from '../../core/header-slot';
import { BLANK, localStamp } from '../../core/format';
import { Ac7Store, FilterKey } from './data/store';
import { OFFEN } from './data/types';
import { ArbeitszeitView } from './views/arbeitszeit';
import { FlowView } from './views/flow';
import { FormularView } from './views/formular';
import { KpiBand } from './views/kpi-band';
import { PersonDrawer } from './views/person-drawer';
import { StintsView } from './views/stints';
import { TimelineView } from './views/timeline';
import { WhereView } from './views/where';

/**
 * AC-7 Verleihliste RT&S (HANDOVER-AC7.md), the interactive version of the paginated AUE-Verleihliste. LOCAL ONLY,
 * masked by default, read-only. One URL-backed state (Ac7Store): the KPI band, the sankey, the Where view, the
 * filter bar and the drawer all set the same filters; breadcrumbs and browser back walk them. Every count is a
 * _Kennzahlen measure (backend/queries/ac7/README.md); fields come only from sm_au_verleihliste.
 */
@Component({
  selector: 'app-ac7-page',
  imports: [HeaderSlot, KpiBand, TimelineView, FlowView, StintsView, WhereView, ArbeitszeitView, PersonDrawer, FormularView],
  providers: [Ac7Store],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ac7.css',
  host: { class: 'ac7', '[class.ac7-is-form]': "store.view() === 'formular'" },
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title ac7-title">Verleihliste RT&amp;S</span>
        <div class="seg" role="group" aria-label="Umgebung">
          @for (e of envs; track e) {
            <button type="button" [attr.aria-pressed]="store.env() === e" (click)="store.setEnv(e)">{{ e }}</button>
          }
        </div>
        <div class="seg seg-sm" role="group" aria-label="Ansicht">
          <button type="button" [attr.aria-pressed]="store.view() === 'analyse'" (click)="store.setView('analyse')">Analyse</button>
          <button type="button" [attr.aria-pressed]="store.view() === 'formular'" (click)="store.setView('formular')">Formular</button>
        </div>
        <div class="asof" title="sm_au_verleihliste hat keinen eigenen Stand; der Gold-Lauf, der die Liste schreibt, aktualisiert auch das RT&amp;S-Importmodell, dessen Datenstand hier steht">
          <span class="asof-label">Stand</span>
          <span class="asof-value">{{ asOf() }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template appHeader="sub">
      <div class="sel-bar ac7-bar" role="navigation" aria-label="Auswahl">
        <button type="button" class="btn btn-ghost" (click)="store.back()" [disabled]="!store.filtered()" aria-label="Einen Schritt zurück">‹ Zurück</button>
        <ol class="ac7-crumbs">
          <li>@if (store.filtered()) { <button type="button" class="linkish" (click)="store.resetAll()">Ganze Liste</button> } @else { <span aria-current="location">Ganze Liste</span> }</li>
          @for (c of store.crumbs(); track c.key; let last = $last) {
            <li>
              @if (last) { <span aria-current="location">{{ c.label }}</span> }
              @else { <button type="button" class="linkish" (click)="store.toCrumb(c.key)">{{ c.label }}</button> }
              <button type="button" class="chip-x" (click)="store.clear(c.key)" [attr.aria-label]="c.label + ' aufheben'">×</button>
            </li>
          }
        </ol>
        <label class="ac7-pick">Tätigkeit
          <select class="select" (change)="store.setTaet($any($event.target).value || null)">
            <option value="" [selected]="store.taet() == null">alle</option>
            @for (t of store.taetigkeiten.rows(); track t.rang) { <option [value]="t.taetigkeit" [selected]="t.rang === store.taet()">{{ t.taetigkeit }}</option> }
          </select>
        </label>
        <label class="ac7-pick">Ort
          <select class="select" (change)="pickOrt($any($event.target).value)">
            <option value="" [selected]="store.ort() == null">alle</option>
            @for (o of orte(); track o.rang) { <option [value]="o.ort" [selected]="o.rang === store.ort()">{{ o.ort }}</option> }
          </select>
        </label>
        <label class="ac7-pick">Auftrag
          <select class="select" (change)="pickAuftrag($any($event.target).value)">
            <option value="" [selected]="store.auftrag() == null">alle</option>
            @for (a of auftraege(); track a.auftrag_token) { <option [value]="a.auftrag" [selected]="a.auftrag_token === store.auftrag()">{{ a.auftrag }} ({{ a.geschaeftsart }})</option> }
          </select>
        </label>
      </div>
    </ng-template>

    <div class="page ac7-page">
      <ac7-kpi-band />
      @if (store.view() === 'formular') {
        <ac7-formular [stand]="asOf()" />
      } @else {
        <ac7-timeline />
        <section class="ac7-pair">
          <ac7-flow />
          <ac7-stints />
        </section>
        <section class="ac7-pair ac7-pair-where">
          <ac7-where />
          <ac7-arbeitszeit />
        </section>
      }
      <footer class="card ac7-foot" aria-label="Stand, offene Punkte, Lesart">
        <div class="ac7-foot-col">
          <h2>Stand</h2>
          <p>{{ asOf() }}</p>
          <p class="muted">Datenstand der RT&amp;S-Kette (Importmodell). Ein Schnappschuss je Aufbereitung: frühere Stände sind nicht gespeichert, deshalb
            zeigt diese Seite keinen Verlauf der Liste.</p>
        </div>
        <div class="ac7-foot-col">
          <h2>Offen</h2>
          <ul class="ac7-offen-list">
            @for (o of offen; track o.key) { <li><span class="ac7-offen">offen</span> {{ o.label }} <span class="muted">({{ o.who }})</span></li> }
          </ul>
        </div>
        <div class="ac7-foot-col">
          <h2>Lesart</h2>
          <ul class="ac7-read">
            <li><strong>Eintritt (abgeleitet)</strong>: frühestes Gültig-ab der Arbeitsverträge.</li>
            <li><strong>Austritt</strong>: Vertragsende, bis SaxMS das Austrittsdatum mit Personenbezug liefert.</li>
            <li><strong>Tätigkeit</strong>: Haupt-Personaltyp aus SaxMS.</li>
            <li><strong>Status aktiv</strong>: ein Einsatz umfasst heute; ohne Ampelfarbe, ■ aktiv und □ inaktiv.</li>
            <li>Nur RT&amp;S; keine Verbindung zu CargoControl. Nur lesend.</li>
          </ul>
        </div>
      </footer>
    </div>

    @if (store.drawer()) {
      <div class="scrim" (click)="store.openDrawer(null)" aria-hidden="true"></div>
      <ac7-person-drawer />
    }
  `,
})
export class Ac7Page {
  protected readonly store = inject(Ac7Store);
  protected readonly envs = ENVS;
  protected readonly offen = OFFEN;

  protected readonly asOf = computed(() => {
    if (this.store.stand.error()) return 'nicht abrufbar (unbestätigt)';
    const v = this.store.stand.rows()[0]?.datenstand_local;
    return v ? localStamp(v) : BLANK;
  });
  protected readonly orte = computed(() => this.store.orte.rows().slice().sort((a, b) => a.ort.localeCompare(b.ort, 'de')));
  protected readonly auftraege = computed(() => this.store.auftraege.rows().slice().sort((a, b) => a.auftrag.localeCompare(b.auftrag, 'de')));

  protected pickOrt(v: string): void {
    if (!v) this.store.clear('ort' as FilterKey);
    else this.store.setOrt(v);
  }
  protected pickAuftrag(v: string): void {
    if (!v) this.store.clear('auftrag');
    else this.store.setAuftrag(v);
  }
}
