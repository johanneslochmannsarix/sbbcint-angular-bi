import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ENVS, Env } from '../core/api';
import { BLANK, dateTimeLU, localMs, localStamp, utcMs } from '../core/format';
import { createQuery } from '../core/query';
import { UiButton, UiOption, UiSeg } from '../shared/ui';
import { StoryService } from '../story/story';

interface AsOf { datenstand_local: string | null }
interface Stand { neuester_stand: string | null }
interface Collected { last_collected: string | null; collector_errors: number | null }

/**
 * Start page (D2 2026-10-21): one tile per showcase - the question it answers, its data-as-of from its own
 * dataset, its scope - and the shared story mode. Four light queries per env plus one for /metrics (one
 * dataset for both envs; each cached 10 min by the backend). The env picked here drives the tiles' as-of and the story; each showcase keeps its own selector.
 */
@Component({
  selector: 'app-start-page',
  imports: [RouterLink, UiButton, UiSeg],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page start">
      <section class="start-head">
        <div>
          <h1 class="start-h1">Drei Fachfragen, ein Backend, keine Klarnamen</h1>
          <p class="muted">Lokale Demo über die Power-BI-Modelle (executeQueries, nur lesend). Personen erscheinen als Pseudonym
            P-xxxxxx, gleich in allen Showcases dieses Backends; Klarnamen nur, wenn das Backend mit <code>run.ps1 -Real</code> läuft.</p>
        </div>
        <div class="start-story">
          <ui-seg ariaLabel="Umgebung für Datenstand und Story" [options]="envOptions" [value]="env()" (valueChange)="env.set($event)" />
          <ui-button kind="primary" (click)="story.start(env())">Story starten ({{ story.steps.length }} Schritte)</ui-button>
        </div>
      </section>

      <section class="start-grid start-grid-4">
        <a class="card start-card" routerLink="/ac1">
          <p class="start-kicker">AC-1 · RT&amp;S</p>
          <h2>Plantafel Ausbildung</h2>
          <p class="start-q">Wer ist wann wo eingeplant, Ausbilder und Auszubildende, vom Monat bis zur Karte des Tages?</p>
          <dl class="start-meta">
            <div><dt>Datenstand</dt><dd>{{ ac1() }}</dd></div>
            <div><dt>Umfang</dt><dd>RT&amp;S, PROD / QA im Showcase wählbar. Nur Planzeiten.</dd></div>
          </dl>
        </a>
        <a class="card start-card" routerLink="/ac2">
          <p class="start-kicker">AC-2 · CargoControl + RT&amp;S</p>
          <h2>Qualifikationen</h2>
          <p class="start-q">Wer hat welche Qualifikation, was läuft wann ab, wo fehlt es?</p>
          <dl class="start-meta">
            <div><dt>Datenstand CC</dt><dd>{{ ac2cc() }}</dd></div>
            <div><dt>Datenstand RT&amp;S</dt><dd>{{ ac2rts() }}</dd></div>
            <div><dt>Umfang</dt><dd>Mandant und PROD / QA im Showcase wählbar.</dd></div>
          </dl>
        </a>
        <a class="card start-card" routerLink="/ac8">
          <p class="start-kicker">AC-8 · CargoControl</p>
          <h2>Leitstand Olten</h2>
          <p class="start-q">Was ist geplant, was wurde den Leuten gesagt, was hat sich seither geändert, wo fehlt SOLL?</p>
          <dl class="start-meta">
            <div><dt>Stand</dt><dd>{{ ac8() }}</dd></div>
            <div><dt>Umfang</dt><dd>Leitstelle Olten (sm_leitstelle_olten), PROD / QA im Showcase wählbar.</dd></div>
          </dl>
        </a>
        <a class="card start-card" routerLink="/ac4">
          <p class="start-kicker">AC-4 · CargoControl</p>
          <h2>FiCo Produktivität</h2>
          <p class="start-q">Welche Firmen und Tourstandorte tragen das Planvolumen, mit welchem Fahranteil, und wie viel Ist und angerechnete Zeit steckt dahinter, bis zur einzelnen Tour?</p>
          <dl class="start-meta">
            <div><dt>Stand</dt><dd>{{ ac4() }}</dd></div>
            <div><dt>Umfang</dt><dd>sm_fico (Lokführer-Touren aller Firmen), PROD / QA im Showcase wählbar. Keine Personenspalten.</dd></div>
          </dl>
        </a>
        <a class="card start-card" routerLink="/ac10">
          <p class="start-kicker">AC-10 · CargoControl</p>
          <h2>Offene Schichten</h2>
          <p class="start-q">Welche Schichten in den nächsten Tagen hat noch niemand, welche davon müssen besetzt werden, und in welchem Depot?</p>
          <dl class="start-meta">
            <div><dt>Stand</dt><dd>{{ ac10() }}</dd></div>
            <div><dt>Umfang</dt><dd>sm_offene_schichten, alle Mandanten (keine Zeilenrechte), PROD / QA im Showcase wählbar. Keine Personendaten.</dd></div>
          </dl>
        </a>
        <a class="card start-card" routerLink="/ac6">
          <p class="start-kicker">AC-6 · CargoControl</p>
          <h2>JUP Planung</h2>
          <p class="start-q">Was plant eine JUP-Version je Tourstandort, Personaltyp und Wochentag, was ändert sich zur nächsten, und hält die Disposition den Plan?</p>
          <dl class="start-meta">
            <div><dt>Stand</dt><dd>{{ ac6() }}</dd></div>
            <div><dt>Umfang</dt><dd>sm_fico, Tabelle fico_planung (Musterwoche je Version), PROD / QA im Showcase wählbar. Keine Personen.</dd></div>
          </dl>
        </a>
        <a class="card start-card" routerLink="/ac7">
          <p class="start-kicker">AC-7 · RT&amp;S</p>
          <h2>Verleihliste</h2>
          <p class="start-q">Wer ist jetzt verliehen, in AÜ oder DL, seit wann und wie lange, mit welcher Arbeitszeit, und wer ist ausgetreten?</p>
          <dl class="start-meta">
            <div><dt>Stand</dt><dd>{{ ac7() }}</dd></div>
            <div><dt>Umfang</dt><dd>sm_au_verleihliste, nur RT&amp;S, PROD / QA im Showcase wählbar. Nur lesend; Personen pseudonymisiert.</dd></div>
          </dl>
        </a>
        <a class="card start-card" routerLink="/ac9">
          <p class="start-kicker">AC-9 · RT&amp;S</p>
          <h2>Rechnungslegung</h2>
          <p class="start-q">Was ist im Monat abrechenbar, wie viel davon AÜ und DL, wie viele Touren sind zurückgemeldet und welche überschreiten die Schwellwerte, bis zur einzelnen Tour?</p>
          <dl class="start-meta">
            <div><dt>Stand</dt><dd>{{ ac9() }}</dd></div>
            <div><dt>Umfang</dt><dd>sm_rechnungslegung_rts, DL und AÜ, nur IST (Plan als Kontext), PROD / QA im Showcase wählbar. Aufträge als Kennung, keine Namen.</dd></div>
          </dl>
        </a>
        <a class="card start-card" routerLink="/ac13">
          <p class="start-kicker">AC-13 · CargoControl</p>
          <h2>Nachbereitung SBB CD</h2>
          <p class="start-q">Wie lief der Monat: Touren und Arbeitszeit, Übernachtungen, Ruhe und Urlaub je Person und Tag, verkaufte Touren und Schulungen, bis zur einzelnen Tour?</p>
          <dl class="start-meta">
            <div><dt>Stand</dt><dd>{{ ac13() }}</dd></div>
            <div><dt>Umfang</dt><dd>sm_nachbereitung_cd, SBB Cargo Deutschland, ab Aug 2026. Nur CC QA (PROD folgt). Personen nur als Pseudonym, ohne Namen im Export.</dd></div>
          </dl>
        </a>
        <a class="card start-card" routerLink="/metrics">
          <p class="start-kicker">Metrics · Plattform</p>
          <h2>Plattform-Metriken</h2>
          <p class="start-q">Wohin geht die Laufzeit der Import-Ketten, welche Dateien und Tabellen kosten am meisten, und welche Schritte laufen stabil?</p>
          <dl class="start-meta">
            <div><dt>Datenstand</dt><dd>{{ metrics() }}</dd></div>
            <div><dt>Umfang</dt><dd>sm_platform_metrics, beide Mandanten, PROD / QA im Showcase wählbar. Betriebsdaten, keine Personen.</dd></div>
          </dl>
        </a>
      </section>

      <section class="card start-notes">
        <h2>Gut zu wissen</h2>
        <ul>
          <li><strong>Umgebung</strong>: jeder Showcase hat seinen eigenen PROD/QA-Schalter; AC-2 zusätzlich den Mandanten. Die Wahl hier gilt für diese Seite und die Story.</li>
          <li><strong>Querverweise</strong>: «Qualifikationen ›» bei einer Person öffnet AC-2 im Pool dieser Person: AC-1 → RT&amp;S, AC-8 → CargoControl. Zwischen RT&amp;S und CargoControl gibt es keine gemeinsame Personen-ID, also keinen Sprung.</li>
          <li><strong>Story</strong>: ← / → blättern, Leertaste Pause, Esc beendet. Personen wählt die Story nach Regel (z.&nbsp;B. «meiste Tage im Monat»), nie von Hand.</li>
        </ul>
      </section>
    </div>
  `,
  styles: [`
    .start-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: flex-end; margin-bottom: 16px; }
    .start-h1 { font-family: var(--font-display); font-size: 24px; margin: 0 0 6px; }
    .start-head p { max-width: 70ch; margin: 0; }
    .start-story { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .start-grid-4 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .start-kicker { margin: 0; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
    .start-card h2 { margin: 2px 0 4px; }
    .start-q { margin: 0 0 10px; color: var(--ink-2); }
    .start-meta { margin: auto 0 0; display: grid; gap: 4px; font-size: 12.5px; }
    .start-meta div { display: grid; grid-template-columns: 9.5em minmax(0, 1fr); gap: 8px; }
    .start-meta dt { color: var(--muted); }
    .start-meta dd { margin: 0; font-variant-numeric: tabular-nums; }
    .start-notes { margin-top: 16px; padding: 14px 18px; }
    .start-notes ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 4px; }
    @media (max-width: 1400px) { .start-grid-4 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 1100px) { .start-grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 640px) { .start-grid-4 { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class StartPage {
  protected readonly story = inject(StoryService);
  protected readonly envOptions: UiOption<Env>[] = ENVS.map((e) => ({ value: e, label: e }));
  protected readonly env = signal<Env>('PROD');

  private readonly ac1Q = createQuery<AsOf>(() => ({ showcase: 'ac1', name: 'data_as_of', params: { env: this.env() } }));
  private readonly ac2ccQ = createQuery<AsOf>(() => ({ showcase: 'ac2', name: 'data_as_of', params: { tenant: 'CARGOCONTROL', env: this.env() } }));
  private readonly ac2rtsQ = createQuery<AsOf>(() => ({ showcase: 'ac2', name: 'data_as_of', params: { tenant: 'RTS', env: this.env() } }));
  private readonly ac8Q = createQuery<Stand>(() => ({ showcase: 'ac8', name: 'stand', params: { env: this.env() } }));

  protected readonly ac1 = computed(() => asOf(this.ac1Q.loading(), this.ac1Q.error() != null, localStamp(this.ac1Q.rows()[0]?.datenstand_local)));
  protected readonly ac2cc = computed(() => asOf(this.ac2ccQ.loading(), this.ac2ccQ.error() != null, localStamp(this.ac2ccQ.rows()[0]?.datenstand_local)));
  protected readonly ac2rts = computed(() => asOf(this.ac2rtsQ.loading(), this.ac2rtsQ.error() != null, localStamp(this.ac2rtsQ.rows()[0]?.datenstand_local)));
  // one platform dataset for every env: last collector run (naive UTC), not tied to the env picked here
  private readonly metricsQ = createQuery<Collected>(() => ({ showcase: 'metrics', name: 'data_as_of', params: {} }));
  protected readonly metrics = computed(() => {
    const r = this.metricsQ.rows()[0];
    const errors = r?.collector_errors ? `, ${r.collector_errors} Collector-Fehler` : '';
    return asOf(this.metricsQ.loading(), this.metricsQ.error() != null, `${dateTimeLU(utcMs(r?.last_collected))}, letzter Collector-Lauf${errors}`);
  });
  protected readonly ac8 = computed(() => asOf(this.ac8Q.loading(), this.ac8Q.error() != null,
    `${dateTimeLU(localMs(this.ac8Q.rows()[0]?.neuester_stand ?? null))}, jüngste Version`));
  // AC-4 (2026-10-21): sm_fico has no load timestamp; the newest reported element Ist stands in for it
  private readonly ac4Q = createQuery<{ juengstes_ist: string | null }>(() => ({ showcase: 'ac4', name: 'stand', params: { env: this.env() } }));
  protected readonly ac4 = computed(() => asOf(this.ac4Q.loading(), this.ac4Q.error() != null,
    `${dateTimeLU(localMs(this.ac4Q.rows()[0]?.juengstes_ist ?? null))}, jüngstes Ist`));
  // AC-10 (2026-10-21): [Stand der Daten] = the SaxMS batch stamp, stored as naive UTC (cc gold datenstand_from_ledger)
  private readonly ac10Q = createQuery<{ datenstand: string | null; regelversion: string | null }>(() => ({ showcase: 'ac10', name: 'stand', params: { env: this.env() } }));
  protected readonly ac10 = computed(() => asOf(this.ac10Q.loading(), this.ac10Q.error() != null,
    `${dateTimeLU(utcMs(this.ac10Q.rows()[0]?.datenstand ?? null))}, Regel ${this.ac10Q.rows()[0]?.regelversion ?? BLANK}`));
  // AC-6 (2026-10-21): same model as AC-4 (no load timestamp; newest element Ist), plus the number of JUP versions
  private readonly ac6Q = createQuery<{ juengstes_ist: string | null; versionen: number | null }>(() => ({ showcase: 'ac6', name: 'stand', params: { env: this.env() } }));
  protected readonly ac6 = computed(() => asOf(this.ac6Q.loading(), this.ac6Q.error() != null,
    `${dateTimeLU(localMs(this.ac6Q.rows()[0]?.juengstes_ist ?? null))}, jüngstes Ist; ${this.ac6Q.rows()[0]?.versionen ?? BLANK} JUP-Versionen`));
  // AC-7 (2026-10-21): sm_au_verleihliste has no stamp; the same RT&S Gold run refreshes the import model, whose stand this is
  private readonly ac7Q = createQuery<AsOf>(() => ({ showcase: 'ac7', name: 'stand', params: { env: this.env() } }));
  protected readonly ac7 = computed(() => asOf(this.ac7Q.loading(), this.ac7Q.error() != null,
    `${localStamp(this.ac7Q.rows()[0]?.datenstand_local)}, RT&S-Kette`));
  // AC-9 (2026-10-21): no Datenstand table in sm_rechnungslegung_rts; the tour fact's Gold write time (naive UTC) and the newest IST month
  private readonly ac9Q = createQuery<{ ingested_max: string | null; letzter_ist_monat: string | null }>(() => ({ showcase: 'ac9', name: 'stand', params: { env: this.env() } }));
  protected readonly ac9 = computed(() => asOf(this.ac9Q.loading(), this.ac9Q.error() != null,
    `${dateTimeLU(utcMs(this.ac9Q.rows()[0]?.ingested_max ?? null))}, IST bis ${this.ac9Q.rows()[0]?.letzter_ist_monat ?? BLANK}`));
  // AC-13 (2026-10-21): sm_nachbereitung_cd exists in CC QA only, so the tile always reads QA (whatever env is picked here)
  private readonly ac13Q = createQuery<{ stand_utc: string | null; vormonat: string | null }>(() => ({ showcase: 'ac13', name: 'stand', params: { env: 'QA' } }));
  protected readonly ac13 = computed(() => asOf(this.ac13Q.loading(), this.ac13Q.error() != null,
    `${dateTimeLU(utcMs(this.ac13Q.rows()[0]?.stand_utc ?? null))} (CC QA), Vormonat ${this.ac13Q.rows()[0]?.vormonat ?? BLANK}`));
}

function asOf(loading: boolean, failed: boolean, text: string): string {
  if (failed) return 'nicht abrufbar (unbestätigt)';
  if (loading && text.startsWith(BLANK)) return 'lädt …';
  return text;
}
