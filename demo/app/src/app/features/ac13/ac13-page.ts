import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject } from '@angular/core';
import { HeaderSlot } from '../../core/header-slot';
import { dateLong, dayMs, localStamp, monthLong, num, utcMs, dateTimeLU } from '../../core/format';
import { AC13_ENVS, Ac13Store } from './data/store';
import { AzView } from './views/az';
import { FillView } from './views/fill';
import { HeatmapView } from './views/heatmap';
import { MengeView } from './views/menge';
import { MonthBar } from './views/month-bar';
import { RegelnView } from './views/regeln';
import { TourDrillView } from './views/tour-drill';
import { UebernachtungView } from './views/uebernachtung';

const monthMs = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).getTime();

/**
 * AC-13 Nachbereitung SBB Cargo Deutschland (sm_nachbereitung_cd, CC QA). LOCAL ONLY, masked by default: persons
 * appear only as the ADR-059 pseudonym (salt AC13), which the core masks again (P-…); there are no names in the
 * export (SAX-30). Monthly follow-up: the three Zedas reports «AZ SBBCD je Tour», «SBB CD Menge» and
 * «Übernachtungstouren DE» as one explorable month - every rule versioned and named where it is used
 * (backend/queries/ac13/README.md). One Ac13Store links every view: month, Standort, Haupttyp, day, person, edge,
 * leg, tour; the breadcrumb and «‹ Zurück» walk it back, the browser back button walks month / Standort / day / edge.
 */
@Component({
  selector: 'app-ac13-page',
  imports: [HeaderSlot, MonthBar, MengeView, AzView, FillView, UebernachtungView, HeatmapView, RegelnView, TourDrillView],
  providers: [Ac13Store],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ac13.css',
  host: { class: 'ac13' },
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title ac13-title">Nachbereitung SBB CD</span>
        <div class="seg" role="group" aria-label="Umgebung">
          @for (e of envs; track e) {
            <button type="button" [attr.aria-pressed]="store.env() === e" (click)="store.env.set(e)">{{ e }}</button>
          }
          <button type="button" disabled title="Das Modell sm_nachbereitung_cd ist in CC PROD noch nicht vorhanden (geplant Do 22.10.).">PROD</button>
        </div>
        <div class="asof" [title]="s()?.hinweis_datenstand ?? ''">
          <span class="asof-label">Stand</span>
          <span class="asof-value">{{ asOf() }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template appHeader="sub">
      <nav class="sel-bar ac13-crumbs" aria-label="Drill-Pfad">
        <button type="button" class="btn btn-ghost" (click)="store.back()" [disabled]="!store.canBack()" aria-label="Eine Ebene zurück">‹ Zurück</button>
        <button type="button" class="linkish" (click)="store.pickStandort(null); store.pickHaupttyp(null); store.pickDay(null); store.pickPerson(null); store.pickEdge(null)">{{ monthName() }}</button>
        @if (store.standortName(); as st) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.pickDay(null); store.pickPerson(null); store.pickEdge(null)">{{ st }}</button>
        }
        @if (store.day(); as d) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.openTour(null)">{{ dayName(d) }}</button>
        }
        @if (store.person(); as p) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.openTour(null)">{{ p }}</button>
        }
        @if (store.edge(); as e) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.pickLeg(null)">{{ e.start }} → {{ e.ziel }}</button>
        }
        @if (store.leg()) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.openTour(null)">Paar</button>
        }
        @if (store.tour()) {
          <span aria-hidden="true">›</span>
          <span>Tour</span>
        }
        <span class="ac13-crumb-gap"></span>
        <label class="ac13-field">Standort
          <select class="select" (change)="store.pickStandort(num($any($event.target).value))">
            <option value="" [selected]="store.standort() == null">alle</option>
            @for (o of store.standorte(); track o.rang) { <option [value]="o.rang" [selected]="o.rang === store.standort()">{{ o.label }}</option> }
          </select>
        </label>
        <label class="ac13-field">Personaltyp (Tour)
          <select class="select" (change)="store.pickHaupttyp(num($any($event.target).value))">
            <option value="" [selected]="store.haupttyp() == null">alle</option>
            @for (o of store.haupttypen(); track o.rang) { <option [value]="o.rang" [selected]="o.rang === store.haupttyp()">{{ o.label }}</option> }
          </select>
        </label>
        @if (store.canBack()) {
          <button type="button" class="linkish" (click)="store.clearAll()">Alles aufheben</button>
        }
      </nav>
    </ng-template>

    <div class="page ac13-page">
      <header class="ac13-lede">
        <h1 class="ac13-h1">{{ headline() }}</h1>
        <p class="ac13-dek">Der Monat von SBB Cargo Deutschland aus CargoControl: Touren und ihre Arbeitszeit, Übernachtungen, Ruhe und Urlaub je Person
          und Tag, verkaufte Touren und Schulungen. Personen nur als Pseudonym, jede Regel mit ihrer Version. Zur Auswertung, nicht zur Disposition.</p>
      </header>
      <ac13-month-bar />
      <ac13-menge />
      <section class="ac13-row ac13-row-az">
        <ac13-az />
        <ac13-fill />
      </section>
      <ac13-uebernachtung />
      <ac13-heatmap />
      <section class="ac13-row ac13-row-even">
        <ac13-regeln />
        <ac13-tour-drill id="ac13-tour" />
      </section>
      <footer class="ac13-foot">
        <dl class="ac13-rules ac13-rules-foot">
          <div><dt>Datenstand</dt><dd>{{ asOf() }}. {{ s()?.hinweis_datenstand }}</dd></div>
          <div><dt>Arbeitszeit · {{ s()?.regel_arbeitszeit }}</dt><dd>Kein Feld für bezahlte Zeit im Export; die Zedas-Regel «Tour Arbeitszeit» wird nicht exportiert.</dd></div>
          <div><dt>Übernachtung · {{ s()?.regel_uebernachtung }}, Paar {{ s()?.regel_paar }}</dt><dd>Beide Wege sind markiert; das Paar ist ein Merkmal.</dd></div>
          <div><dt>Verkaufte Touren · {{ s()?.regel_verkauf }}</dt><dd>Schichttyp «… DL Dienstleister».</dd></div>
          <div><dt>Schulungen · {{ s()?.regel_schulung }}</dt><dd>Tour mit einem Ausbildungselement.</dd></div>
          <div><dt>Ohne Eintrag · {{ s()?.regel_ohne_eintrag }}</dt><dd>Nur als Anzahl je Standort und Tag, zusammen mit «übrige Abwesenheit».</dd></div>
          <div><dt>Namen</dt><dd>Ohne Namen im Export. {{ s()?.hinweis_namen }} Eine Verknüpfung mit «Ruhetagsplanung SBB CD» gibt es deshalb nicht.</dd></div>
          <div><dt>Abwesenheiten</dt><dd>{{ s()?.hinweis_abwesenheit }} Nur Kontonamen aus dem Katalog, kein Grund.</dd></div>
          <div><dt>Standort</dt><dd>{{ s()?.hinweis_standort }}</dd></div>
          @if (s()?.spitzentage) { <div><dt>Spitzentag</dt><dd>{{ s()?.hinweis_spitzentage }}</dd></div> }
          <div><dt>Nicht hier</dt><dd>Saldi Zeitkonto: in CargoControl. Touren RT&amp;S: in Abklärung. Abnahme: Anzahl Touren je Tag und Standort, nicht Stunden.</dd></div>
        </dl>
      </footer>
    </div>
  `,
})
export class Ac13Page {
  protected readonly store = inject(Ac13Store);
  protected readonly envs = AC13_ENVS;
  protected readonly num = (v: string) => (v === '' ? null : Number(v));
  protected readonly s = computed(() => this.store.stand.rows()[0] ?? null);

  constructor() {
    // a tour opened anywhere (calendar row, AZ point, day list, overnight pair) brings the tour drill into view
    effect(() => {
      if (!this.store.tour()) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      queueMicrotask(() => document.getElementById('ac13-tour')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' }));
    });
  }
  protected readonly dayName = (d: string) => dateLong(dayMs(d)!);
  protected readonly monthName = computed(() => {
    const m = this.store.month();
    return m ? `${monthLong(monthMs(m))}${this.store.isVormonat() ? ' (Vormonat)' : ''}` : 'Monat';
  });
  protected readonly asOf = computed(() => {
    const s = this.s();
    if (!s) return '…';
    const utc = utcMs(s.stand_utc);
    return utc != null ? dateTimeLU(utc) : localStamp(s.stand_local);
  });
  protected readonly headline = computed(() => {
    const r = this.store.monthRow();
    const m = this.store.month();
    if (!r || !m) return 'Nachbereitung SBB Cargo Deutschland';
    const where = this.store.standortName() ? `, ${this.store.standortName()}` : '';
    return `${monthLong(monthMs(m))}${where}: ${num(r.touren)} Touren, davon ${num(r.offen)} offen, ${num(r.ue_touren)} Übernachtungstouren`;
  });
}
