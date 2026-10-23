import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import { ThemeService } from '../../../core/theme';
import { BLANK, dateOnly, num } from '../../../core/format';
import { PseudonymChip } from '../../../shared/pseudonym-chip';
import { QualLink } from '../../../shared/qual-link';
import { Ac7Store } from '../data/store';
import { Ga } from '../data/types';
import { GA_NAME, STATUS_GLYPH, ac7Colors } from '../data/palette';
import { activeByHiddenStint, stintDays } from './timeline';

/**
 * View 7 - person drawer: the two stints, status, Arbeitszeit, Eintritt (abgeleitet), Austritt (Vertragsende, bis
 * SAX-35), and the AC-2 RT&S qualifications link (same person_sk, 100 % in the import model, Step 2). No AC-1 link:
 * 5 of 171 persons have a Plantafel row. Only fields of the model (ruling: the form's date-of-birth column does not
 * exist here, not even as a placeholder). Read-only.
 */
@Component({
  selector: 'ac7-person-drawer',
  imports: [PseudonymChip, QualLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './person-drawer.css',
  host: { class: 'drawer ac7-drawer', role: 'dialog', 'aria-modal': 'true', '[attr.aria-label]': 'title()', '(keydown.escape)': 'close()' },
  template: `
    @if (row(); as r) {
      <header class="drawer-head">
        <div>
          <h2>{{ title() }}</h2>
          <p class="ac7-drawer-chips">
            @if (store.mode() === 'real') { <app-pseudonym [person]="store.personOf(r)" /> } @else { <span class="muted">Pseudonym</span> }
            <span class="ac7-status" [class.is-aktiv]="r.status_code === 'AKTIV'">{{ glyph[r.status_code] }} {{ r.status ?? r.status_code }}</span>
            <span class="ac7-ga"><i class="key" [style.background]="c().ga[r.geschaeftsart]"></i>{{ r.geschaeftsart }} · {{ gaName[r.geschaeftsart] }}</span>
          </p>
        </div>
        <button type="button" class="btn btn-ghost" (click)="close()" aria-label="Schliessen" autofocus>×</button>
      </header>
      <div class="drawer-body drawer-pad">
        <section class="ac7-stint-list" aria-label="Die letzten zwei Einsatzzeiträume">
          @for (s of stints(); track s.n) {
            <article class="ac7-stint" [class.is-older]="s.n === 2">
              <h3><i class="key" [style.background]="s.ga ? c().ga[s.ga] : null"></i>{{ s.n === 1 ? 'Letzter Einsatz' : 'Vorletzter Einsatz' }}
                <span class="ac7-stint-dur">{{ s.days != null ? num(s.days) + ' Tage' : '' }}</span></h3>
              <p class="ac7-stint-dates">{{ s.von }} – {{ s.bis }}</p>
              <dl class="ac7-dl">
                <div><dt>Geschäftsart</dt><dd>{{ s.ga ?? BLANK }}</dd></div>
                <div><dt>Ort (erste Tour)</dt><dd>
                  @if (s.ort) { <button type="button" class="linkish" (click)="store.setOrt(s.ort)">{{ s.ort }}</button> } @else { {{ BLANK }} }
                  @if ((s.orte ?? 0) > 1) { <span class="muted"> + {{ s.orte! - 1 }} weitere</span> }
                </dd></div>
                <div><dt>Auftrag (RT&amp;S)</dt><dd>
                  @if (s.auftrag) { <button type="button" class="linkish" (click)="store.setAuftrag(s.auftrag)">{{ s.auftrag }}</button> } @else { {{ BLANK }} }
                </dd></div>
                <div><dt>Entleiher · Branche</dt><dd><span class="ac7-offen">offen</span> Zuordnung des Auftrags (Marcel Ludwig)</dd></div>
              </dl>
            </article>
          } @empty {
            <p class="muted">Keine Einsatzzeiträume im Modell.</p>
          }
          @if (hiddenStint()) {
            <p class="ac7-note">◆ Aktiv durch einen Einsatz, der nicht unter den letzten zwei ist: der letzte Einsatz beginnt erst am {{ e1von() }}.</p>
          }
        </section>
        <dl class="ac7-dl ac7-dl-person">
          <div><dt>Tätigkeit (Haupt-Personaltyp)</dt><dd>{{ r.taetigkeit ?? BLANK }}</dd></div>
          <div><dt>Arbeitszeit</dt><dd>{{ r.arbeitszeit_monat_h != null ? num(r.arbeitszeit_monat_h, 1) + ' h / Monat' : 'nicht im Vertrag' }}
            @if (r.arbeitszeit_woche_h != null) { <span class="muted">({{ num(r.arbeitszeit_woche_h, 1) }} h / Woche)</span> }
            <span class="muted">{{ r.vertrag_gueltig === false ? ' · aus der jüngsten Vertragsversion (keine gültig am Stichtag)' : ' · Vertrag gültig am Stichtag' }}</span></dd></div>
          <div><dt>Eintritt (abgeleitet)</dt><dd>{{ d(r.eintritt) }} <span class="muted">frühestes Vertragsdatum, SaxMS führt kein Eintrittsdatum (SAX-37)</span></dd></div>
          <div><dt>Austritt (Vertragsende)</dt><dd>{{ r.austritt ? d(r.austritt) : 'keiner' }} <span class="muted">Ersatz bis SAX-35 das Austrittsdatum liefert</span></dd></div>
          <div><dt>Verleihstationen insgesamt</dt><dd>{{ num(r.anzahl_verleihstationen) }} <span class="muted">verschiedene AÜ-/DL-Aufträge</span></dd></div>
          <div><dt>Erster / letzter Einsatztag</dt><dd>{{ d(r.erster_einsatz_von) }} / {{ d(r.letzter_einsatz_bis) }}</dd></div>
        </dl>
        <div class="ac7-drawer-actions">
          <button type="button" class="btn" (click)="store.setPerson(r.person_sk)">{{ store.person() === r.person_sk ? 'Personenfilter aufheben' : 'Nur diese Person zeigen' }}</button>
          <app-qual-link [person]="r.person_sk" tenant="RTS" [env]="store.env()" text="Qualifikationen in AC-2 RT&amp;S ›" />
        </div>
        <p class="chart-note">Keine Verknüpfung zu CargoControl: es gibt keine gemeinsame Personen-ID der beiden Pools. Nur lesend; das
          beschreibbare Feld unter Tätigkeit kommt nicht ins BI.</p>
      </div>
    } @else {
      <header class="drawer-head"><h2>Person nicht in der Liste</h2>
        <button type="button" class="btn btn-ghost" (click)="close()" aria-label="Schliessen">×</button></header>
      <p class="drawer-pad muted">Unter dem aktuellen Filter oder nach einem Neustart des Backends (neue Pseudonyme) nicht gefunden.</p>
    }
  `,
})
export class PersonDrawer {
  protected readonly store = inject(Ac7Store);
  private readonly theme = inject(ThemeService);
  protected readonly c = computed(() => ac7Colors(this.theme.tokens()));
  protected readonly glyph = STATUS_GLYPH;
  protected readonly gaName = GA_NAME;
  protected readonly BLANK = BLANK;
  protected readonly num = num;
  protected readonly d = (v: string | null) => (v ? dateOnly(v) : BLANK);

  protected readonly row = computed(() => this.store.drawerRow());
  protected readonly title = computed(() => {
    const r = this.row();
    return r ? this.store.personLabel(r) : 'Person';
  });
  protected readonly hiddenStint = computed(() => {
    const r = this.row();
    return r ? activeByHiddenStint(r) : false;
  });
  protected readonly e1von = computed(() => this.d(this.row()?.einsatz1_von ?? null));
  protected readonly stints = computed(() => {
    const r = this.row();
    if (!r) return [];
    const out: { n: 1 | 2; von: string; bis: string; days: number | null; ga: Ga | null; ort: string | null; orte: number | null; auftrag: string | null }[] = [];
    if (r.einsatz1_von) out.push({ n: 1, von: this.d(r.einsatz1_von), bis: this.d(r.einsatz1_bis), days: stintDays(r.einsatz1_von, r.einsatz1_bis),
      ga: r.einsatz1_geschaeftsart, ort: r.einsatz1_ort, orte: r.einsatz1_anzahl_orte, auftrag: r.einsatz1_auftrag });
    if (r.einsatz2_von) out.push({ n: 2, von: this.d(r.einsatz2_von), bis: this.d(r.einsatz2_bis), days: stintDays(r.einsatz2_von, r.einsatz2_bis),
      ga: r.einsatz2_geschaeftsart, ort: r.einsatz2_ort, orte: r.einsatz2_anzahl_orte, auftrag: r.einsatz2_auftrag });
    return out;
  });

  protected close(): void {
    this.store.openDrawer(null);
  }
}
