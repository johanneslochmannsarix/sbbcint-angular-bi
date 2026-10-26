import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { BLANK, dateOnly, num } from '../../../core/format';
import { Ac7Store } from '../data/store';
import { ListeRow } from '../data/types';
import { STATUS_GLYPH } from '../data/palette';
import { UiButton } from '../../../shared/ui';

/**
 * View 8 - «Formular»: the filtered list laid out like the BA form «Liste der Leiharbeitskräfte» (06/2024) and like the
 * live PDF (AUE-Verleihliste): header block with the open placeholders, one row per person, both Einsatzzeiträume in
 * one cell. The browser's print-to-PDF gives A4 landscape (print stylesheet in ac7.css). It is a bridge to the live
 * PDF, not a replacement: the PDF stays the deliverable. Only model columns; the form's date-of-birth column does not
 * exist here at all (ruling 2026-10-01).
 */
@Component({
  selector: 'ac7-formular',
  imports: [UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './formular.css',
  host: { class: 'ac7-form' },
  template: `
    <div class="ac7-form-tools">
      <p class="muted">So druckt der Browser die gefilterte Liste (Querformat A4). Der Bericht AUE-Verleihliste bleibt das Dokument.</p>
      <ui-button kind="primary" (click)="print()">Drucken oder als PDF sichern</ui-button>
    </div>
    <article class="ac7-sheet" aria-label="Liste der Leiharbeitskräfte">
      <header class="ac7-sheet-head">
        <div>
          <h1>Liste der Leiharbeitskräfte</h1>
          <p class="ac7-sheet-sub">Übersicht verliehenes Personal RT&amp;S, {{ env() }}, Stand {{ stand() }}</p>
        </div>
        <dl class="ac7-sheet-fields">
          <div><dt>Firma / Betrieb</dt><dd><span class="ac7-offen">offen</span> Angabe RT&amp;S</dd></div>
          <div><dt>AÜG-Erlaubnisnummer</dt><dd><span class="ac7-offen">offen</span> Angabe RT&amp;S</dd></div>
          <div><dt>Hauptsitz / Niederlassung</dt><dd><span class="ac7-offen">offen</span> Angabe RT&amp;S</dd></div>
        </dl>
      </header>
      <p class="ac7-sheet-pop">Personen mit mindestens einem AÜ- oder DL-Einsatz in RT&amp;S{{ filterText() }}. Ob nur verliehene Personen und ob DL-Einsätze auf die
        Liste gehören, entscheidet RT&amp;S (offen).</p>
      <table class="ac7-sheet-tbl">
        <thead>
          <tr>
            <th class="r" scope="col">Lfd. Nr.</th>
            <th scope="col">Name, Vorname</th>
            <th scope="col">Eintritt<small>abgeleitet</small></th>
            <th scope="col">Austritt<small>Vertragsende</small></th>
            <th scope="col">Tätigkeit</th>
            <th class="r" scope="col">Arbeitszeit<small>h / Monat</small></th>
            <th scope="col">Letzte zwei Einsatzzeiträume<small>von – bis</small></th>
            <th scope="col">Entleiher<small>RT&amp;S-Auftrag</small></th>
            <th scope="col">Branche des Entleihers</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.person_sk; let i = $index) {
            <tr [class.is-aktiv]="r.status_code === 'AKTIV'">
              <td class="r">{{ i + 1 }}</td>
              <td><button type="button" class="linkish ac7-sheet-name" (click)="store.openDrawer(r.person_sk)">{{ store.personLabel(r) }}</button></td>
              <td>{{ d(r.eintritt) }}</td>
              <td>{{ r.austritt ? d(r.austritt) : '' }}</td>
              <td>{{ r.taetigkeit ?? BLANK }}</td>
              <td class="r">{{ r.arbeitszeit_monat_h != null ? num(r.arbeitszeit_monat_h, 1) : BLANK }}</td>
              <td class="ac7-sheet-stints">
                @if (r.einsatz1_von) { <span>{{ d(r.einsatz1_von) }} – {{ d(r.einsatz1_bis) }}</span> }
                @if (r.einsatz2_von) { <span>{{ d(r.einsatz2_von) }} – {{ d(r.einsatz2_bis) }}</span> }
              </td>
              <td class="ac7-sheet-stints">
                @if (r.einsatz1_auftrag) { <span>{{ r.einsatz1_auftrag }}</span> }
                @if (r.einsatz2_auftrag) { <span>{{ r.einsatz2_auftrag }}</span> }
              </td>
              <td><span class="ac7-offen">offen</span></td>
              <td class="ac7-sheet-status">{{ glyph[r.status_code] }} {{ r.status ?? r.status_code }}</td>
            </tr>
          }
        </tbody>
      </table>
      <footer class="ac7-sheet-foot">
        <p><strong>{{ num(rows().length) }} Personen in der Auswahl.</strong> Quelle: SaxMS RT&amp;S (Dispositionsaufträge, Arbeitsverträge), Modell
          sm_au_verleihliste. Eintritt = frühestes Vertragsdatum (Näherung, SAX-37); Austritt = Vertragsende bis zum Austrittsdatum aus SAX-35;
          Entleiher und Branche folgen nach der Zuordnung der Aufträge durch RT&amp;S; Arbeitszeit in Stunden, bis die Schwelle für
          Vollzeit / Teilzeit / geringfügig festgelegt ist.</p>
        <p>{{ mode() === 'masked' ? 'Pseudonymisiert: Namen erscheinen als P-…, Aufträge als T-….' : 'Mit Klarnamen (nur lokal, nicht teilen).' }}</p>
      </footer>
    </article>
  `,
})
export class FormularView {
  protected readonly store = inject(Ac7Store);
  readonly stand = input<string>(BLANK);
  protected readonly glyph = STATUS_GLYPH;
  protected readonly BLANK = BLANK;
  protected readonly num = num;
  protected readonly d = (v: string | null) => (v ? dateOnly(v) : BLANK);
  protected readonly env = computed(() => this.store.env());
  protected readonly mode = computed(() => this.store.mode());

  /** like the PDF: by Nachname, Vorname (masked: by pseudonym) */
  protected readonly rows = computed<ListeRow[]>(() =>
    this.store.liste.rows().slice().sort((a, b) => this.store.personLabel(a).localeCompare(this.store.personLabel(b), 'de')));
  protected readonly filterText = computed(() => {
    const cs = this.store.crumbs();
    return cs.length ? `, Auswahl: ${cs.map((c) => c.label).join(', ')}` : '';
  });

  protected print(): void {
    window.print();
  }
}
