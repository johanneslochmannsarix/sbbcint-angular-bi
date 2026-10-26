import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, computed, inject } from '@angular/core';
import { ENVS, Env } from '../../core/api';
import { HeaderSlot } from '../../core/header-slot';
import { StoryService } from '../../story/story';
import { BLANK, dateLong, dateTimeLU, dayMs, num, utcMs } from '../../core/format';
import { UiButton, UiOption, UiSeg, UiSelect, UiSelectOption } from '../../shared/ui';
import { Ac10Store } from './data/store';
import { ZWINGEND_LABEL, Zwingend } from './data/types';
import { ElementeView } from './views/elemente';
import { HeatmapView } from './views/heatmap';
import { JetztView } from './views/jetzt';
import { PersonaltypenView } from './views/personaltypen';
import { StrukturView } from './views/struktur';
import { TagesdrillView } from './views/tagesdrill';
import { ZeitraumView } from './views/zeitraum';

/**
 * AC-10 Offene Schichten CargoControl (HANDOVER-AC10.md). LOCAL ONLY. The model carries no person column, so
 * nothing here is a person; free text (Bezeichnung, element list) arrives masked. One URL-backed state
 * (Ac10Store): Zeitraum brush, Jetzt band, Belegungstafel, Struktur/Rangliste, Personaltypen and the element
 * view all set the same filters and drill path (Mandant > Depot > Tag > Schicht); breadcrumbs and browser back
 * walk it. Every number is a _Kennzahlen measure (backend/queries/ac10/README.md).
 */
@Component({
  selector: 'app-ac10-page',
  imports: [HeaderSlot, UiSeg, UiSelect, UiButton, ZeitraumView, JetztView, HeatmapView, StrukturView, TagesdrillView, PersonaltypenView, ElementeView],
  providers: [Ac10Store],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ac10.css',
  host: { class: 'ac10' },
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title ac10-title">Offene Schichten</span>
        <ui-seg ariaLabel="Umgebung" [options]="envOptions" [value]="store.env()" (valueChange)="store.setEnv($event)" />
        <ui-seg size="sm" ariaLabel="Besetzungspflicht" [options]="zwOptions" [value]="store.zwingend()" (valueChange)="store.setZwingend($event)" />
        <div class="asof" title="Zeitpunkt des Quellexports (agg_gold_build_info.datenstand_batch, UTC-Stempel der SaxMS-Lieferung)">
          <span class="asof-label">Stand</span>
          <span class="asof-value">{{ asOf() }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template appHeader="sub">
      <div class="sel-bar ac10-bar" role="navigation" aria-label="Auswahl">
        <ui-button kind="ghost" extraClass="ac10-back" (click)="store.back()" [disabled]="store.crumbs().length < 2" label="Eine Ebene zurück">‹ Zurück</ui-button>
        <ol class="ac10-crumbs">
          @for (c of store.crumbs(); track c.level; let last = $last) {
            <li>
              @if (last) { <span aria-current="location">{{ crumbText(c.label, c.level) }}</span> }
              @else { <button type="button" class="linkish" (click)="store.toCrumb(c.level)">{{ crumbText(c.label, c.level) }}</button> }
            </li>
          }
        </ol>
        <label class="ac10-pick">Mandant
          <ui-select [options]="mandantOptions()" [value]="store.mandant() ?? ''" (valueChange)="store.pickMandant($event || null)" />
        </label>
        <label class="ac10-pick">Depot
          <ui-select [options]="depotOptions()" [value]="depotValue()" (valueChange)="pickDepot($event)" />
        </label>
        <label class="ac10-pick">Haupt-Personaltyp
          <ui-select [options]="haupttypOptions()" [value]="store.haupttyp() ?? ''" (valueChange)="store.setHaupttyp($event || null)" />
        </label>
        <label class="ac10-pick">Kategorie (ohne Schicht)
          <ui-select [options]="kategorieOptions()" [value]="store.kategorie() ?? ''" (valueChange)="store.setKategorie($event || null)" />
        </label>
        @if (filtered()) { <button type="button" class="linkish" (click)="store.resetAll()">Alles zurücksetzen</button> }
        @if (store.unknownLabels().length) {
          <span class="ac10-warn" role="status">Nicht in diesem Modell, ignoriert: {{ store.unknownLabels().join(', ') }}</span>
        }
        @if (store.labelMismatch()) {
          <span class="ac10-warn" role="alert">Das Modell wurde inzwischen neu geladen; Auswahl bitte neu setzen.</span>
        }
      </div>
    </ng-template>

    <div class="page ac10-page">
      <ac10-zeitraum />
      <ac10-jetzt (jump)="jump($event)" />
      <section class="ac10-main">
        <ac10-heatmap id="ac10-heatmap" />
        <ac10-struktur />
      </section>
      <ac10-tagesdrill id="ac10-drill" />
      <section class="ac10-pair">
        <ac10-personaltypen />
        <ac10-elemente id="ac10-elemente" />
      </section>
      <footer class="card ac10-foot" aria-label="Stand und Regeln">
        <dl class="ac10-stamps">
          <div><dt>Stand der Daten</dt><dd>{{ asOf() }}</dd></div>
          <div><dt>Aufbereitet</dt><dd>{{ built() }}</dd></div>
          <div><dt>Regelversion Besetzungspflicht</dt><dd>{{ stand()?.regelversion ?? BLANK }}</dd></div>
          <div><dt>Aufbereitetes Zeitfenster</dt><dd>{{ stand()?.zeitfenster ?? BLANK }}</dd></div>
          <div><dt>Betriebsstellen mit echtem Namen</dt><dd>{{ stand()?.betriebsstellen_name_pct != null ? num(stand()!.betriebsstellen_name_pct!, 1) + ' %' : BLANK }}</dd></div>
        </dl>
        <p class="ac10-rule"><strong>Offen</strong> = keine Person zugeordnet, sonst nichts (Kundenregel). «Nicht zwingend» = in SaxMS «Schicht nicht zwingend besetzen»
          (staffing_optional, Regel {{ stand()?.regelversion ?? '…' }}). <strong>Geschlossene Schichten:</strong> SaxMS hat die Frage nach shift_closed (SAX-28) noch nicht
          beantwortet; einen Zustand «geschlossen» gibt es hier deshalb nicht. Kein Verlauf: das Modell ist ein Schnappschuss je Aufbereitung,
          frühere Stände sind nicht gespeichert. Diese Auswertung enthält keine Personendaten (D0); Bezeichnungen erscheinen pseudonymisiert.</p>
        <details class="ac10-hinweise">
          <summary>Hinweise aus dem Modell (wie im Bericht)</summary>
          <dl>
            @for (h of hinweise(); track h.label) { <dt>{{ h.label }}</dt><dd>{{ h.text }}</dd> }
          </dl>
        </details>
      </footer>
    </div>
  `,
})
export class Ac10Page {
  protected readonly store = inject(Ac10Store);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly envs = ENVS;
  protected readonly zw: Zwingend[] = ['alle', 'zwingend', 'nicht'];
  protected readonly zwLabel = ZWINGEND_LABEL;
  protected readonly envOptions: UiOption<Env>[] = this.envs.map((e) => ({ value: e, label: e }));
  protected readonly zwOptions: UiOption<Zwingend>[] = this.zw.map((z) => ({ value: z, label: this.zwLabel[z] }));
  protected readonly BLANK = BLANK;
  protected readonly num = num;

  protected readonly stand = computed(() => this.store.stand.rows()[0] ?? null);
  protected readonly asOf = computed(() => dateTimeLU(utcMs(this.stand()?.datenstand ?? null)));
  protected readonly built = computed(() => dateTimeLU(utcMs(this.stand()?.gold_build_ts ?? null)));
  protected readonly hinweise = computed(() => {
    const s = this.stand();
    if (!s) return [];
    return [['Datenstand', s.hinweis_datenstand], ['Besetzungspflicht', s.hinweis_besetzungspflicht], ['Betriebsstellen', s.hinweis_betriebsstellen],
      ['Geschlossene Schichten', s.hinweis_geschlossene_schichten], ['Stammdaten', s.hinweis_stammdaten]]
      .map(([label, text]) => ({ label: label!, text: text ?? BLANK }));
  });

  protected readonly mandanten = computed(() => this.store.scopeOf().mandant.slice()
    .sort((a, b) => (a.label.startsWith('(') ? 1 : 0) - (b.label.startsWith('(') ? 1 : 0) || a.label.localeCompare(b.label, 'de')));
  protected readonly depots = computed(() => {
    const m = this.store.mandant();
    return this.store.scopeOf().depot.filter((d) => !m || d.mandant === m)
      .sort((a, b) => a.mandant.localeCompare(b.mandant, 'de') || a.label.localeCompare(b.label, 'de'))
      .map((d) => ({ value: `${d.mandant}\u001f${d.label}`, text: m ? d.label : `${d.label} · ${d.mandant}` }));
  });
  protected readonly depotValue = computed(() => (this.store.depot() ? `${this.store.mandant()}\u001f${this.store.depot()}` : ''));
  protected readonly haupttypen = computed(() => {
    const m = this.store.mandant();
    const seen = new Map<string, number>();
    for (const h of this.store.scopeOf().haupttyp) if (!m || h.mandant === m) seen.set(h.label, h.mandanten ?? 1);
    return [...seen].sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([label, n]) => ({ label, text: n > 1 ? `${label} (⇄ ${n} Mandanten)` : label }));
  });
  protected readonly kategorien = computed(() => this.store.scopeOf().kategorie.map((k) => k.label).sort((a, b) => a.localeCompare(b, 'de')));
  protected readonly mandantOptions = computed<UiSelectOption[]>(() => [{ value: '', label: 'alle' }, ...this.mandanten().map((m) => ({ value: m.label, label: m.label }))]);
  protected readonly depotOptions = computed<UiSelectOption[]>(() => [{ value: '', label: 'alle' }, ...this.depots().map((d) => ({ value: d.value, label: d.text }))]);
  protected readonly haupttypOptions = computed<UiSelectOption[]>(() => [{ value: '', label: 'alle' }, ...this.haupttypen().map((h) => ({ value: h.label, label: h.text }))]);
  protected readonly kategorieOptions = computed<UiSelectOption[]>(() => [{ value: '', label: 'alle' }, ...this.kategorien().map((k) => ({ value: k, label: k }))]);
  protected readonly filtered = computed(() => !!(this.store.mandant() || this.store.haupttyp() || this.store.kategorie() || this.store.tag() ||
    this.store.zwingend() !== 'alle' || !this.store.isDefaultWindow()));

  constructor() {
    // shared story mode: the story reads and sets this page's state while the page is shown
    inject(DestroyRef).onDestroy(inject(StoryService).register('ac10', this.store));
  }

  protected crumbText(label: string, level: string): string {
    return level === 'tag' ? dateLong(dayMs(label)!) : label;
  }
  protected pickDepot(v: string): void {
    if (!v) {
      this.store.pickMandant(this.store.mandant());
      return;
    }
    const [m, d] = v.split('\u001f');
    this.store.pickDepot(m, d);
  }
  protected jump(target: 'elemente' | 'drill' | 'heatmap'): void {
    const el = (this.host.nativeElement as HTMLElement).querySelector(`#ac10-${target}`);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
}
