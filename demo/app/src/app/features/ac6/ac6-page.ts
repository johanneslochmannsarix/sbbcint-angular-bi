import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ENVS } from '../../core/api';
import { HeaderSlot } from '../../core/header-slot';
import { dateOnly, dateTimeLU, hours, localMs, num } from '../../core/format';
import { Ac6Store, S1_NAME, S1_PERIOD } from './data/store';
import { DAY_LONG } from './data/week';
import { DiffView } from './views/diff';
import { HeatmapView } from './views/heatmap';
import { HierarchyView } from './views/hierarchy';
import { KostenView } from './views/kosten';
import { TourDrillView } from './views/tour-drill';
import { VergleichView } from './views/vergleich';
import { VersionBar } from './views/version-bar';
import { WochenuhrView } from './views/wochenuhr';

/**
 * AC-6 JUP Planung (sm_fico, fico_planung). LOCAL ONLY, masked by default (the only free text, the tour name, is
 * a token; the plan carries no person). Every view answers a controller question (backend/queries/ac6/README.md)
 * and shares one Ac6Store: weekday bars -> weekday, heatmap / ring / diff / dumbbell -> Firma, Tourstandort,
 * Personaltyp, Tätigkeit, tour list -> tour. The breadcrumb walks the drill path back. Deep link:
 * /ac6?tourstandort=<name> (for AC-4's «Planung (JUP) ansehen»).
 */
@Component({
  selector: 'app-ac6-page',
  imports: [HeaderSlot, VersionBar, WochenuhrView, HeatmapView, HierarchyView, DiffView, VergleichView, TourDrillView, KostenView],
  providers: [Ac6Store],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ac6.css',
  host: { class: 'ac6' },
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title ac6-title">JUP Planung</span>
        <div class="seg" role="group" aria-label="Umgebung">
          @for (e of envs; track e) {
            <button type="button" [attr.aria-pressed]="store.env() === e" (click)="store.setEnv(e)">{{ e }}</button>
          }
        </div>
        <div class="asof" title="sm_fico hat keinen Ladezeitpunkt: jüngste rückgemeldete Ist-Zeit eines Tourelements (wie AC-4). Die JUP selbst hat kein Datum.">
          <span class="asof-label">Stand</span>
          <span class="asof-value">{{ asOf() }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template appHeader="sub">
      <nav class="sel-bar ac6-crumbs" aria-label="Drill-Pfad">
        <button type="button" class="btn btn-ghost ac6-back" (click)="store.back()" [disabled]="!store.canBack()" aria-label="Eine Ebene zurück">‹ Zurück</button>
        <button type="button" class="linkish" (click)="store.pickFirma(null); store.pickStandort(null); store.pickPtyp(null); store.pickTaet(null)">{{ store.versionName() ?? 'Version' }}</button>
        @if (store.firmaName(); as f) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.pickStandort(null); store.pickPtyp(null); store.pickTaet(null)">{{ f }}</button>
        }
        @if (store.standortName(); as s) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.pickPtyp(null); store.pickTaet(null)">{{ s }}</button>
        }
        @if (store.ptypName(); as p) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.pickTaet(null)">{{ p }}</button>
        }
        @if (store.taetName(); as t) {
          <span aria-hidden="true">›</span>
          <button type="button" class="linkish" (click)="store.tour.set(null)">{{ t }}</button>
        }
        @if (store.tour()) {
          <span aria-hidden="true">›</span>
          <span>Tour</span>
        }
        @if (store.tag() != null) {
          <button type="button" class="ac6-daychip" (click)="store.pickTag(null)" [attr.aria-label]="'Wochentag ' + dayLong() + ' aufheben'">{{ dayLong() }} ×</button>
        }
        <span class="ac6-crumb-gap"></span>
        <label class="ac6-field">Personaltyp
          <select class="select" (change)="store.pickPtyp(num($any($event.target).value))">
            <option value="" [selected]="store.ptyp() == null">alle</option>
            @for (p of store.ptyps(); track p.rang) { <option [value]="p.rang" [selected]="p.rang === store.ptyp()">{{ p.label }}</option> }
          </select>
        </label>
        <label class="ac6-field">Tätigkeit
          <select class="select" (change)="store.pickTaet(num($any($event.target).value))">
            <option value="" [selected]="store.taet() == null">alle</option>
            @for (t of store.taets(); track t.rang) { <option [value]="t.rang" [selected]="t.rang === store.taet()">{{ t.label }}</option> }
          </select>
        </label>
        @if (store.canBack()) {
          <button type="button" class="linkish" (click)="store.clearAll()">Alles aufheben</button>
        }
      </nav>
    </ng-template>

    <div class="page ac6-page">
      <header class="ac6-lede">
        <h1 class="ac6-h1">{{ headline() }}</h1>
        <p class="ac6-dek">Die JUP plant eine Musterwoche, keine Kalendertage. Hier lässt sie sich Version für Version lesen: wo und wann geplant ist, wer sie trägt, was sich zwischen Versionen ändert und, für «{{ s1 }}», wie viel davon die Disposition hält.</p>
      </header>
      <ac6-version-bar />
      <section class="ac6-row ac6-row-hero">
        <ac6-wochenuhr />
        <ac6-heatmap />
      </section>
      <section class="ac6-row ac6-row-even">
        <ac6-hierarchy />
        <ac6-diff />
      </section>
      <ac6-vergleich />
      <ac6-tour-drill />
      <ac6-kosten />
      <footer class="ac6-foot">
        <p>Datenstand: {{ asOf() }}. {{ versionsNote() }}</p>
        <p>Offen (SAX-40): die Gültigkeitsfelder der JUP sind leer, eine Version wird nach Namen gewählt; einen Zeitraum hat nur «{{ s1 }}» ({{ period }}, vom Controlling bestätigt). Keine Kilometer (keine Spalte im Export), keine Klassifikation (Controlling-Workbook, ADR-046), nur Planzeiten. Zählungen ohne gelöschte Zeilen.</p>
      </footer>
    </div>
  `,
})
export class Ac6Page {
  protected readonly store = inject(Ac6Store);
  protected readonly envs = ENVS;
  protected readonly s1 = S1_NAME;
  protected readonly period = S1_PERIOD;
  protected readonly num = (v: string) => (v === '' ? null : Number(v));

  constructor() {
    const route = inject(ActivatedRoute);
    const ts = route.snapshot.queryParamMap.get('tourstandort');
    if (ts) this.store.pendingStandort.set(ts);
    effect(() => {
      const name = this.store.pendingStandort();
      if (!name || !this.store.dims.rows().length) return;
      const r = this.store.rankOf('standort', name);
      this.store.pendingStandort.set(null);
      if (r != null) this.store.pickStandort(r);
    });
  }

  protected readonly dayLong = computed(() => DAY_LONG[this.store.tag() ?? 0]);

  protected readonly asOf = computed(() => {
    const s = this.store.stand.rows()[0];
    if (!s) return '…';
    return `Ist bis ${dateTimeLU(localMs(s.juengstes_ist))}, Disposition ${dateOnly(s.dispo_von)} – ${dateOnly(s.dispo_bis)}`;
  });
  protected readonly versionsNote = computed(() => {
    const s = this.store.stand.rows()[0];
    if (!s) return '';
    return `${num(s.versionen)} JUP-Versionen; ${num(s.elemente_ohne_version)} ungeplante Elemente ohne Version und ohne Tour sind in keiner Ansicht.`;
  });
  protected readonly headline = computed(() => {
    const v = this.store.versionRow();
    if (!v) return 'JUP Planung';
    const where = this.store.standortName() ?? this.store.firmaName();
    return `${v.label}: ${num(v.touren)} Touren und ${hours(v.dauer_h, 0)} je Musterwoche${where ? `, hier ${where}` : ''}`;
  });
}
