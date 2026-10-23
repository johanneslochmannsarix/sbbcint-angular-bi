import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import { ThemeService } from '../../../core/theme';
import { BLANK, num } from '../../../core/format';
import { Ac7Store } from '../data/store';
import { GA_KEY, Ga, KpiRow, StatusCode } from '../data/types';
import { STATUS_GLYPH, ac7Colors } from '../data/palette';

interface Tile {
  id: string;
  caption: string;
  value: string;
  note: string;
  active: boolean;
  key?: string;
  glyph?: string;
  click: (() => void) | null;
  aria: string;
}

/**
 * View 1 - the KPI band, laid out like the header fields of the BA form: a caption in the corner of a ruled box, the
 * figure inside. Every figure is a _Kennzahlen measure under the filter set; each tile group ignores its own
 * dimension, so a tile stays a selector (click = filter everything, click again = clear).
 */
@Component({
  selector: 'ac7-kpi-band',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './kpi-band.css',
  host: { class: 'ac7-band', role: 'group', 'aria-label': 'Kennzahlen der Verleihliste' },
  template: `
    @for (t of tiles(); track t.id) {
      <button type="button" class="ac7-field" [class.is-on]="t.active" [class.is-static]="!t.click"
              [attr.aria-pressed]="t.click ? t.active : null" [disabled]="!t.click" [attr.aria-label]="t.aria" (click)="t.click?.()">
        <span class="ac7-field-cap">
          @if (t.key) { <i class="key" [style.background]="t.key"></i> }
          @if (t.glyph) { <span class="ac7-glyph" aria-hidden="true">{{ t.glyph }}</span> }
          {{ t.caption }}
        </span>
        <span class="ac7-field-val">{{ t.value }}</span>
        <span class="ac7-field-note">{{ t.note }}</span>
      </button>
    }
  `,
})
export class KpiBand {
  private readonly store = inject(Ac7Store);
  private readonly theme = inject(ThemeService);

  protected readonly tiles = computed<Tile[]>(() => {
    const k: KpiRow | null = this.store.kpi.rows()[0] ?? null;
    const c = ac7Colors(this.theme.tokens());
    const st = this.store.status();
    const ga = this.store.ga();
    const jahr = this.store.jahr();
    const y = k?.jahr_heute ?? new Date().getFullYear();
    const v = (x: number | null | undefined) => (k ? num(x ?? 0) : BLANK);
    const status = (s: StatusCode, caption: string, val: number | null | undefined, note: string): Tile => ({
      id: s, caption, value: v(val), note, active: st === s, glyph: STATUS_GLYPH[s],
      click: () => this.store.setStatus(s), aria: `${caption}: ${v(val)}. ${st === s ? 'Filter aufheben' : 'Nach diesem Status filtern'}`,
    });
    const gat = (g: Ga, caption: string, val: number | null | undefined, note: string): Tile => ({
      id: g, caption, value: v(val), note, active: ga === GA_KEY[g], key: c.ga[g],
      click: () => this.store.setGa(g), aria: `${caption}: ${v(val)}. ${ga === GA_KEY[g] ? 'Filter aufheben' : 'Nach dieser Geschäftsart filtern'}`,
    });
    const left = (year: number, val: number | null | undefined, note: string): Tile => ({
      id: `j${year}`, caption: `Ausgetreten ${year}`, value: v(val), note, active: jahr === year,
      click: () => this.store.setJahr(year), aria: `Ausgetreten ${year}: ${v(val)}`,
    });
    return [
      {
        id: 'all', caption: 'Auf der Liste', value: v(k?.personen),
        note: k ? `${num(k.mit_einsatz2)} mit zweitem Einsatz, ${num(k.einsatz1_geplant)} mit geplantem neuestem Einsatz` : '',
        active: false, click: this.store.filtered() ? () => this.store.resetAll() : null,
        aria: `Auf der Liste: ${v(k?.personen)}${this.store.filtered() ? '. Alle Filter aufheben' : ''}`,
      },
      status('AKTIV', 'Jetzt verliehen', k?.aktiv, 'ein Einsatz umfasst heute (Status aktiv)'),
      status('INAKTIV', 'Inaktiv', k?.inaktiv, 'kein Einsatz umfasst heute'),
      gat('AÜ', 'Nur AÜ', k?.nur_au, k ? `mit AÜ insgesamt ${num(k.mit_au)}` : ''),
      gat('DL', 'Nur DL', k?.nur_dl, 'Dienstleistung, u. a. SBB Cargo Deutschland'),
      gat('AÜ+DL', 'AÜ und DL', k?.au_und_dl, 'beide Geschäftsarten'),
      left(y, k?.austritt_jahr, k?.austritt_geplant ? `bis heute; ${num(k.austritt_geplant)} geplant` : 'bis heute, Vertragsende'),
      left(y - 1, k?.austritt_vorjahr, 'Vertragsende (bis SAX-35)'),
    ];
  });
}
