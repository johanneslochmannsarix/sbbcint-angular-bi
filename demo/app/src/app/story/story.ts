import { EffectRef, Injectable, Injector, WritableSignal, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import type { Ac1Store } from '../features/ac1/data/store';
import type { DataStore } from '../features/ac2/data/model';
import type { SelectionService } from '../features/ac2/data/selection';
import type { Ac8Store } from '../features/ac8/data/store';
import type { Ac4Store } from '../features/ac4/data/store';
import type { Ac10Store } from '../features/ac10/data/store';
import type { Ac9Store } from '../features/ac9/data/store';
import { Env, MaskedPerson, Tenant, personText } from '../core/api';
import { addDays, dateLong, dateShort, dayMs, hours, isoDay, localMs, monthLong, num, pct, today } from '../core/format';

/**
 * The shared story mode (D2 2026-10-21; AC-4 steps 9-11 added the same day; AC-9 steps after the RT&S thread, same day): one scripted walk across the showcases for a live demo,
 * autoplay with pause / next / back. Built on the showcases' own state: AC-8's story timeline (storyIndex),
 * AC-1's store entry points (HANDOVER-D2-FROM-AC1 §5: env, audience, person, openDay, openPerson, minute) and
 * AC-2's selection (openPerson = drawer). Each page registers its state here while it is shown; the story
 * navigates, waits for the page and its data, then sets a few signals.
 *
 * People are chosen at RUN TIME by a rule (busiest Ausbilder, dispatcher with most untold changes, ...) and
 * referred to by pseudonym only; never a hard-coded name or key. Under run.ps1 -Real the same script shows
 * the real labels (personText). A rule that finds nobody says so and the story goes on.
 */

export interface StoryHosts {
  ac1: Ac1Store;
  ac2: { store: DataStore; sel: SelectionService };
  ac8: Ac8Store;
  ac4: Ac4Store;
  ac10: Ac10Store;
  ac9: Ac9Store;
}

interface Ctx {
  env: Env;
  dispatcher: MaskedPerson | null;
  ausbilder: MaskedPerson | null;
  trainee: MaskedPerson | null;
  month: number | null;
  day: number | null;
  /** AC-4: Planmonat «yyyy-MM» and Tourstandort (depot_sk) picked by rule */
  ficoMonth: string | null;
  ficoStandort: string | null;
  /** AC-9: Abrechnungsmonat «yyyy-MM» and order token (T-…) picked by rule */
  rlMonth: string | null;
  rlAuftrag: string | null;
}

interface Step {
  /** the story visits AC-1 / AC-2 / AC-8 / AC-4; /metrics is not part of it */
  showcase: keyof StoryHosts;
  title: string;
  /** css selector scrolled into view once the step is set */
  target: string;
  /** reading time before autoplay moves on */
  dwellMs: number;
  run(s: StoryService, ctx: Ctx): Promise<string>;
}

const DWELL = 9000;
const WAIT_MS = 45_000;
const MAP_STEP_MS = 450;
const MAP_TICKS = 28;

class Cancelled extends Error {}

@Injectable({ providedIn: 'root' })
export class StoryService {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly hosts: { [K in keyof StoryHosts]: WritableSignal<StoryHosts[K] | null> } = {
    ac1: signal(null),
    ac2: signal(null),
    ac8: signal(null),
    ac4: signal(null),
    ac10: signal(null),
    ac9: signal(null),
  };

  readonly steps: readonly Step[] = STEPS;
  /** current step (null = story off) */
  readonly index = signal<number | null>(null);
  readonly playing = signal(false);
  readonly busy = signal(false);
  readonly caption = signal('');
  readonly error = signal<string | null>(null);
  readonly active = computed(() => this.index() !== null);
  readonly step = computed(() => {
    const i = this.index();
    return i == null ? null : this.steps[i];
  });

  private ctx: Ctx = freshCtx('PROD');
  private run = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** A page registers its state while it is shown; returns the unregister function (call on destroy). */
  register<K extends keyof StoryHosts>(showcase: K, host: StoryHosts[K]): () => void {
    const slot = this.hosts[showcase] as WritableSignal<StoryHosts[K] | null>;
    slot.set(host);
    return () => {
      if (untracked(slot) === host) slot.set(null);
    };
  }

  start(env: Env = 'PROD'): void {
    this.ctx = freshCtx(env);
    this.playing.set(true);
    this.go(0);
  }
  stop(): void {
    this.run++;
    this.clearTimer();
    this.playing.set(false);
    this.busy.set(false);
    this.index.set(null);
    this.caption.set('');
    this.error.set(null);
  }
  next(): void {
    const i = this.index();
    if (i == null) return;
    if (i + 1 >= this.steps.length) {
      this.playing.set(false);
      return;
    }
    this.go(i + 1);
  }
  back(): void {
    const i = this.index();
    if (i != null && i > 0) this.go(i - 1);
  }
  togglePlay(): void {
    const play = !this.playing();
    this.playing.set(play);
    this.clearTimer();
    if (play && !this.busy()) this.schedule();
  }

  // ------------------------------------------------------------------ engine

  private go(i: number): void {
    const id = ++this.run;
    this.clearTimer();
    this.index.set(i);
    this.error.set(null);
    this.busy.set(true);
    this.caption.set('');
    const step = this.steps[i];
    this.enter(step.showcase)
      .then(() => step.run(this, this.ctx))
      .then((text) => {
        if (id !== this.run) return;
        this.caption.set(text);
        this.busy.set(false);
        scrollTo(step.target);
        if (this.playing()) this.schedule();
      })
      .catch((e: unknown) => {
        if (id !== this.run || e instanceof Cancelled) return;
        this.busy.set(false);
        this.playing.set(false);
        this.error.set(e instanceof Error ? e.message : String(e));
      });
  }

  private schedule(): void {
    const step = this.step();
    if (!step) return;
    this.timer = setTimeout(() => this.next(), step.dwellMs);
  }
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** navigate to the showcase (if not there) and wait for its page to register */
  private async enter(showcase: keyof StoryHosts): Promise<void> {
    const path = `/${showcase}`;
    // whole path segment only: '/ac10?…' must not count as being on '/ac1' (AC-10 step, 2026-10-21)
    if (!new RegExp(`^${path}(?:[/?#]|$)`).test(this.router.url)) await this.router.navigateByUrl(path);
    await this.until(() => this.hosts[showcase]() != null, `Seite ${showcase.toUpperCase()}`);
  }

  host<K extends keyof StoryHosts>(k: K): StoryHosts[K] {
    const h = this.hosts[k]() as StoryHosts[K] | null;
    if (!h) throw new Cancelled();
    return h;
  }

  /** resolves once cond() is true (re-checked on every signal it reads); rejects after a timeout */
  until(cond: () => boolean, what: string, timeoutMs = WAIT_MS): Promise<void> {
    const id = this.run;
    return new Promise<void>((resolve, reject) => {
      let ref: EffectRef | null = null;
      const done = (ok: boolean) => {
        clearTimeout(t);
        queueMicrotask(() => ref?.destroy());
        if (id !== this.run) reject(new Cancelled());
        else if (ok) resolve();
        else reject(new Error(`${what}: keine Daten nach ${timeoutMs / 1000} s. Mit «Weiter» überspringen oder «Zurück».`));
      };
      const t = setTimeout(() => done(false), timeoutMs);
      ref = effect(() => {
        if (id !== this.run) return done(false);
        if (cond()) done(true);
      }, { injector: this.injector });
    });
  }

  /** AC-1 map: step the plan clock from the current position to `endMinute`, in multiples of the map's 15-min
   *  step so that a long day still plays in about MAP_TICKS ticks */
  async playClock(store: Ac1Store, endMinute: number): Promise<void> {
    const id = this.run;
    const stride = Math.max(1, Math.ceil((endMinute - store.minute()) / 15 / MAP_TICKS)) * 15;
    while (store.minute() < endMinute) {
      await new Promise((r) => setTimeout(r, MAP_STEP_MS));
      if (id !== this.run) throw new Cancelled();
      store.minute.update((m) => Math.min(endMinute, m + stride));
    }
  }

  personText(p: MaskedPerson | null): string {
    return p ? personText(p) : '–';
  }
}

function freshCtx(env: Env): Ctx {
  return { env, dispatcher: null, ausbilder: null, trainee: null, month: null, day: null, ficoMonth: null, ficoStandort: null, rlMonth: null, rlAuftrag: null };
}

function scrollTo(selector: string): void {
  requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function argmax<T>(items: Iterable<T>, score: (x: T) => number): T | null {
  let best: T | null = null;
  let max = -Infinity;
  for (const x of items) {
    const s = score(x);
    if (s > max) [best, max] = [x, s];
  }
  return best;
}

function count<K>(m: Map<K, number>, k: K, n = 1): void {
  m.set(k, (m.get(k) ?? 0) + n);
}

const TENANT_TEXT: Record<Tenant, string> = { CARGOCONTROL: 'CargoControl', RTS: 'RT&S' };

/** opens a person in AC-2 and returns the caption; «keine Qualifikationsdaten» when AC-2 cannot resolve it */
async function ac2Person(s: StoryService, ctx: Ctx, p: MaskedPerson | null, tenant: Tenant, what: string): Promise<string> {
  const { store, sel } = s.host('ac2');
  if (!p) {
    sel.openPerson('', tenant, ctx.env);
    return `${what}: niemand gefunden, kein Sprung möglich.`;
  }
  sel.openPerson(p.key, tenant, ctx.env);
  await s.until(() => {
    const m = store.model();
    return !!m && m.tenant === tenant && m.env === ctx.env;
  }, `AC-2 ${TENANT_TEXT[tenant]}`);
  const person = store.model()!.personByKey.get(p.key);
  if (!person) return `${what} ${s.personText(p)}: keine Qualifikationsdaten in AC-2 ${TENANT_TEXT[tenant]}.`;
  return `${what} ${s.personText(p)} in AC-2 ${TENANT_TEXT[tenant]}: ${num(person.cells.size)} Qualifikationen gehalten, `
    + `${num(person.gaps)} fehlen${person.expired ? `, ${num(person.expired)} abgelaufen` : ''}.`;
}

const STEPS: Step[] = [
  {
    showcase: 'ac8',
    title: 'Leitstand Olten: die unruhigste Woche',
    target: 'ac8-story-bar',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac8');
      st.env.set(ctx.env);
      st.worker.set('disponent');
      st.clearSelection();
      await s.until(() => !st.kpiWeek.loading() && st.kpiWeek.result() != null && st.weeks().length > 0, 'AC-8 Wochenkennzahlen');
      // rule: the week of the page's window (4 weeks back, 8 ahead) with the most changes the employee was not
      // told (changed shifts + previous duty-plan rows)
      const rows = st.kpiWeek.rows();
      const best = argmax(rows, (r) => (r.geaendert_nicht_kommuniziert ?? 0) + (r.dp_vorheriger_stand ?? 0));
      const idx = best ? st.weeks().findIndex((w) => w.from === best.von.slice(0, 10)) : -1;
      st.playing.set(false);
      st.storyIndex.set(idx >= 0 ? idx : 0);
      const w = st.storyWeek();
      if (!best || !w) return 'Keine Wochenkennzahlen im Fenster.';
      return `${w.label}: ${num(best.schichten)} Disponenten-Schichten geplant, ${num(best.kommuniziert)} kommuniziert, `
        + `${num(best.geaendert_nicht_kommuniziert)} geändert und nicht kommuniziert. Gewählt als Woche des Fensters mit den meisten nicht kommunizierten Änderungen.`;
    },
  },
  {
    showcase: 'ac8',
    title: 'Was der Disponent gesehen hat und was gilt',
    target: 'ac8-dienstplan-diff',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac8');
      await s.until(() => !st.dienstplan.loading() && st.dienstplan.result() != null && st.persons.result() != null, 'AC-8 Dienstplan');
      const w = st.storyWeek();
      const inWeek = st.dienstplan.rows().filter((r) => !w || (r.dienstplan_datum.slice(0, 10) >= w.from && r.dienstplan_datum.slice(0, 10) <= w.to));
      // rule: the person whose duty plan holds the most «vorheriger Stand» rows (told ≠ current) that week,
      // else the most rows that differ from the plan, else the most rows
      const score = new Map<string, number>();
      for (const r of inWeek) {
        if (!r.person_sk) continue;
        count(score, r.person_sk, (r.dienstplan_quelle.startsWith('vorheriger') ? 10_000 : 0) + (r.weicht_vom_plan_ab ? 100 : 0) + 1);
      }
      const key = argmax(score.keys(), (k) => score.get(k)!);
      ctx.dispatcher = st.person$(key);
      st.person.set(key);
      if (!key) return 'Kein Dienstplan in dieser Woche.';
      const rows = inWeek.filter((r) => r.person_sk === key);
      const prev = rows.filter((r) => r.dienstplan_quelle.startsWith('vorheriger')).length;
      return `${s.personText(ctx.dispatcher)}: ${num(rows.length)} Dienstplanzeilen in der Woche, davon ${num(prev)} «vorheriger Stand» `
        + `(die Person kennt eine ältere Version als die geltende). Gewählt nach Regel, nicht von Hand.`;
    },
  },
  {
    showcase: 'ac2',
    title: 'Seine Qualifikationen (AC-2 CargoControl)',
    target: '.drawer',
    dwellMs: DWELL,
    run: (s, ctx) => ac2Person(s, ctx, ctx.dispatcher, 'CARGOCONTROL', 'Disponent'),
  },
  {
    // AC-10 (2026-10-21): after the Leitstand thread, the same Mandant's open shifts next week
    showcase: 'ac10',
    title: 'Offene Schichten: wo nächste Woche noch niemand eingeteilt ist',
    target: '#ac10-heatmap',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac10');
      // window: next Monday .. Sunday (the board's «Nächste Woche» preset)
      const t = today();
      const mon = addDays(t, 7 - ((new Date(t).getDay() + 6) % 7));
      const from = isoDay(mon);
      const to = isoDay(addDays(mon, 6));
      st.storyFocus(ctx.env, from, to, null, null);
      const loaded = () => {
        const r = st.struktur.result();
        return !st.struktur.loading() && r?.env === ctx.env && r.params['date_from'] === from && st.scope.result()?.env === ctx.env;
      };
      await s.until(loaded, 'AC-10 Struktur');
      // rule: the Mandant that holds the depot named «Olten» (the Leitstelle of the AC-8 steps), then its depot
      // with the most open zwingend shifts that week ([Anzahl ungeplante Schichten] with is_zwingend, per depot)
      const olten = st.scope.rows().find((r) => r.art === 'depot' && /olten/i.test(r.label));
      if (!olten) return 'Kein Depot «Olten» im Modell, also kein Mandant für diesen Schritt.';
      const rows = st.struktur.rows().filter((r) => r.mandant === olten.mandant);
      const m = rows.find((r) => r.ebene === 'mandant');
      const d = argmax(rows.filter((r) => r.ebene === 'depot' && r.depot), (r) => r.ungeplant_zwingend ?? 0);
      const week = `${dateShort(mon)}–${dateShort(addDays(mon, 6))}`;
      if (!m || !d?.depot || !d.ungeplant_zwingend) {
        st.storyFocus(ctx.env, from, to, olten.mandant, null);
        return `Nächste Woche (${week}), ${olten.mandant}: keine offene zwingende Schicht.`;
      }
      st.storyFocus(ctx.env, from, to, olten.mandant, d.depot);
      await s.until(() => st.depot() === d.depot && !st.depotTage.loading() && st.depotTage.result()?.params['date_from'] === from, 'AC-10 Belegungstafel');
      return `Nächste Woche (${week}), ${olten.mandant}: ${num(m.ungeplant)} von ${num(m.schichten)} Schichten ohne eingeteilte Person, ${num(m.ungeplant_zwingend)} davon zwingend. `
        + `Am meisten offen und zwingend: ${d.depot} mit ${num(d.ungeplant_zwingend)} (markiert in der Belegungstafel). Gewählt nach Regel; offen heisst nur: niemand eingeteilt.`;
    },
  },
  {
    showcase: 'ac1',
    title: 'Plantafel: der Ausbilder-Monat mit dem meisten Betrieb',
    target: 'ac1-month-calendar',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac1');
      st.env.set(ctx.env);
      st.setAudience('ausbilder');
      st.day.set(null);
      await s.until(() => st.months.result() != null && st.persons.result() != null, 'AC-1 Monate');
      // rule: the calendar month with the most training (min of Ausbilder and Auszubildende plan rows), then its
      // Ausbilder with the most days alongside a trainee of the same order (else the most tour days)
      const m = argmax(st.months.rows(), (r) => Math.min(r.rows_ausbilder ?? 0, r.rows_auszubildende ?? 0));
      if (!m) return 'Keine Ausbilder-Pläne.';
      const month = dayMs(`${m.year_month.slice(0, 7)}-01`)!;
      st.month.set(month);
      ctx.month = month;
      await s.until(() => !st.monthTours.loading() && st.monthTours.result()?.params['date_from']?.startsWith(m.year_month.slice(0, 7)) === true, 'AC-1 Monatsplan');
      const days = new Map<string, Set<string>>();
      for (const r of st.monthTours.rows()) {
        if (!st.people().get(r.person_sk)?.audiences.has('ausbilder')) continue;
        (days.get(r.person_sk) ?? days.set(r.person_sk, new Set()).get(r.person_sk)!).add(r.date.slice(0, 10));
      }
      const shared = new Map([...days.keys()].map((k) => [k, sameOrderTrainees(st, k).size]));
      const key = argmax(days.keys(), (k) => shared.get(k)! * 1000 + days.get(k)!.size);
      if (!key) return `${monthLong(month)}: kein Ausbilder mit Plan.`;
      st.openPerson(key, 'ausbilder');
      ctx.ausbilder = st.personOf(key);
      return `${monthLong(month)}: der Monat mit der meisten Ausbildung (${num(m.rows_ausbilder)} Ausbilder-, ${num(m.rows_auszubildende)} Azubi-Planzeilen). `
        + `${s.personText(ctx.ausbilder)} ist an ${num(days.get(key)!.size)} Tagen eingeplant, an ${num(shared.get(key))} davon mit Auszubildenden im gleichen Auftrag. Nur Planzeiten, Kalendermonat.`;
    },
  },
  {
    showcase: 'ac1',
    title: 'Ein Tag im Gantt: wer im gleichen Auftrag ist',
    target: 'ac1-day-gantt',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac1');
      if (!ctx.ausbilder) return 'Kein Ausbilder aus dem vorigen Schritt.';
      // rule: the day of the month on which the most trainees share a training order with this Ausbilder
      const trainees = sameOrderTrainees(st, ctx.ausbilder.key);
      const any = st.monthTours.rows().find((r) => r.person_sk === ctx.ausbilder!.key)?.date.slice(0, 10) ?? null;
      const d = argmax(trainees.keys(), (k) => trainees.get(k)!.size) ?? any;
      if (!d) return 'Dieser Ausbilder hat im Monat keinen Auftrag mit Namen.';
      const day = dayMs(d)!;
      ctx.day = day;
      st.openPerson(ctx.ausbilder.key, 'ausbilder', day);
      st.openDay(day);
      await s.until(() => !st.dayTours.loading() && st.dayTours.result() != null && !st.dayTags.loading(), 'AC-1 Tagesplan');
      const rel = st.related();
      return `${dateLong(day)}: ${s.personText(ctx.ausbilder)} und ${num(rel.filter((r) => r.sameOrder).length)} Auszubildende im gleichen Auftrag`
        + `${rel.some((r) => r.tags.length) ? `, ${num(rel.filter((r) => r.tags.length).length)} laut Freitext` : ''}. Jede Zeile sagt, warum sie da ist; eine feste Zuordnung gibt es im Export nicht.`;
    },
  },
  {
    showcase: 'ac1',
    title: 'Der Tag einer Auszubildenden',
    target: 'ac1-day-gantt',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac1');
      if (ctx.day == null || !ctx.ausbilder) return 'Kein Tag aus dem vorigen Schritt.';
      if (st.person() !== ctx.ausbilder.key) st.openPerson(ctx.ausbilder.key, 'ausbilder', ctx.day);
      await s.until(() => !st.dayTours.loading() && st.dayTours.result() != null && !st.dayTags.loading(), 'AC-1 Tagesplan');
      // rule: the first trainee of the same order (rows are sorted by the Gantt's own order)
      const pick = st.related().find((r) => r.audience === 'auszubildende' && r.sameOrder) ?? st.related().find((r) => r.audience === 'auszubildende');
      if (!pick) return 'An diesem Tag keine Auszubildende im gleichen Auftrag.';
      st.openPerson(pick.key, 'auszubildende', ctx.day);
      ctx.trainee = st.personOf(pick.key);
      await s.until(() => !st.dayTours.loading(), 'AC-1 Tagesplan');
      const n = st.dayRowsByPerson().get(pick.key)?.length ?? 0;
      return `Drill-down: ${s.personText(ctx.trainee)} an diesem Tag, ${num(n)} geplante Touren. Zurück zum Ausbilder über seine Zeile im Gantt.`;
    },
  },
  {
    showcase: 'ac1',
    title: 'Der Tag auf der Karte',
    target: 'ac1-day-map',
    dwellMs: 3000,
    async run(s, ctx) {
      const st = s.host('ac1');
      if (ctx.day == null || !ctx.trainee) return 'Keine Person aus dem vorigen Schritt.';
      await s.until(() => st.locations.result() != null || st.locations.error() != null, 'AC-1 Orte');
      const rows = st.dayRowsByPerson().get(ctx.trainee.key) ?? [];
      const at = (v: string | null) => localMs(v);
      const day = ctx.day;
      const starts = rows.map((r) => at(r.start_time)).filter((x): x is number => x != null);
      const ends = rows.map((r) => at(r.end_time)).filter((x): x is number => x != null);
      // from the first planned start to the last planned end, clipped to the day (a multi-day tour carries its
      // whole plan window on every day row) and rounded to the map's 15-min steps
      const from = starts.length ? Math.max(0, Math.floor((Math.min(...starts) - day) / 60_000 / 15) * 15) : 6 * 60;
      const last = ends.length ? Math.min(23 * 60 + 45, Math.ceil((Math.max(...ends) - day) / 60_000 / 15) * 15) : 18 * 60;
      st.minute.set(Math.min(from, last));
      await s.playClock(st, last);
      const whole = from === 0 && last === 23 * 60 + 45 ? ' (die Tour läuft über mehrere Tage, also der ganze Tag)' : '';
      return `Abgespielt von ${clock(Math.min(from, last))} bis ${clock(last)}${whole}: Position laut Plan (auf der Tour von A nach B), keine Ortung, keine Zwischenposition.`;
    },
  },
  {
    showcase: 'ac2',
    title: 'Qualifikationslücken (AC-2 RT&S)',
    target: '.drawer',
    dwellMs: DWELL,
    async run(s, ctx) {
      // rule: the trainee; if AC-2 holds no qualification for her (common for Auszubildende), the Ausbilder
      const text = await ac2Person(s, ctx, ctx.trainee, 'RTS', 'Auszubildende');
      const held = ctx.trainee ? s.host('ac2').store.model()?.personByKey.get(ctx.trainee.key)?.cells.size ?? 0 : 0;
      if (held > 0 || !ctx.ausbilder) return text;
      return `${text} Deshalb der Ausbilder: ${await ac2Person(s, ctx, ctx.ausbilder, 'RTS', 'Ausbilder')}`;
    },
  },
  {
    // AC-9 (2026-10-21): the RT&S thread ends with what is billed (an AC-7 step, when it comes, sits before this one)
    showcase: 'ac9',
    title: 'Rechnungslegung RT&S: was davon wird verrechnet',
    target: 'ac9-beleg',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac9');
      st.storyFocus(ctx.env, null);
      await s.until(() => !st.monate.loading() && st.monate.result()?.env === ctx.env && st.monate.result()?.params['auftrag'] == null
        && st.defaultMonth() != null, 'AC-9 Monate');
      // rule: the page's own default - the latest Abrechnungsmonat before the running one whose reported tours reach
      // half the busiest month (the last month Finance can bill in full)
      const m = st.defaultMonth()!;
      ctx.rlMonth = m;
      st.storyFocus(ctx.env, m);
      await s.until(() => !st.kpi.loading() && st.kpi.result()?.env === ctx.env && st.kpi.result()?.params['von']?.startsWith(m) === true
        && st.kpi.result()?.params['auftrag'] == null, 'AC-9 Kennzahlen');
      const t = st.kpiTotal();
      const month = monthLong(dayMs(`${m}-01`)!);
      if (!t?.touren) return `${month}: keine zurückgemeldete Tour.`;
      const ga = new Map(st.kpiGa().map((r) => [r.geschaeftsart, r.netto_h]));
      return `${month}: ${num(t.touren)} zurückgemeldete Touren mit ${hours(t.brutto_h)} IST. Nach ${hours(t.pause_h)} Pause sind ${hours(t.netto_h)} abrechenbar `
        + `(AÜ ${hours(ga.get('AÜ'))}, DL ${hours(ga.get('DL'))}); AZU und Fahrten werden mit abgerechnet, Einarbeitung nie. Gewählt als letzter voll abrechenbarer Monat.`;
    },
  },
  {
    showcase: 'ac9',
    title: 'Der grösste Auftrag des Monats',
    target: '#ac9-auftrag',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac9');
      const m = ctx.rlMonth;
      if (!m) return 'Kein Monat aus dem vorigen Schritt.';
      if (st.von() !== m || st.auftrag()) st.storyFocus(ctx.env, m);
      await s.until(() => !st.auftraege.loading() && st.auftraege.result()?.env === ctx.env && st.auftraege.result()?.params['von']?.startsWith(m) === true, 'AC-9 Aufträge');
      // rule: the order with the most billable hours (ohne Pause) in that month
      const rows = st.auftraege.rows().filter((r) => r.auftrag_token);
      const big = argmax(rows, (r) => r.netto_h);
      if (!big?.auftrag_token) return 'Kein Auftrag mit zurückgemeldeten Touren in diesem Monat.';
      const tok = big.auftrag_token;
      ctx.rlAuftrag = tok;
      st.storyFocus(ctx.env, m, tok);
      await s.until(() => !st.touren.loading() && st.touren.result()?.params['auftrag'] === tok && !st.tage.loading() && st.tage.result() != null, 'AC-9 Auftrag');
      // no count of unreported tours here: the low AÜ Rückmeldequote is a parked finding (Johannes 2026-10-08), the
      // story does not put it in the spotlight
      const total = rows.reduce((a, r) => a + r.netto_h, 0);
      return `${big.dor_name ?? tok} (${big.geschaeftsart}): ${hours(big.netto_h)} abrechenbar in ${num(big.touren)} Touren, ${pct(big.netto_h / (total || 1))} des Monats; `
        + `${num(big.ue12)} Touren über 12 h. Der Auftragsname ist der Schlüssel für Kunde und Preis. Gewählt als Auftrag mit den meisten abrechenbaren Stunden.`;
    },
  },
  {
    showcase: 'ac9',
    title: 'Seine längste Tour, Element für Element',
    target: '#ac9-tour',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac9');
      const m = ctx.rlMonth;
      const tok = ctx.rlAuftrag;
      if (!m || !tok) return 'Kein Auftrag aus dem vorigen Schritt.';
      if (st.auftrag() !== tok || st.von() !== m) st.storyFocus(ctx.env, m, tok);
      await s.until(() => !st.touren.loading() && st.touren.result()?.params['auftrag'] === tok, 'AC-9 Touren');
      // rule: the order's reported tour with the longest IST (brutto, the Schwellwert basis)
      const pick = argmax(st.touren.rows().filter((r) => r.ist_vollstaendig && r.ist_dauer_h != null), (r) => r.ist_dauer_h!);
      if (!pick) return 'In diesem Monat hat der Auftrag keine zurückgemeldete Tour.';
      st.storyFocus(ctx.env, m, tok, pick.tour);
      await s.until(() => !st.tourKopf.loading() && st.tourKopf.result()?.params['tour'] === pick.tour
        && !st.elemente.loading() && st.elemente.result()?.params['tour'] === pick.tour, 'AC-9 Tour');
      const k = st.tourKopf.rows()[0];
      if (!k) return 'Die Tour ist nicht mehr im Modell.';
      const h = k.ist_dauer_h ?? 0;
      const over = h > 14 ? 'über 14 h' : h > 12 ? 'über 12 h' : h > 10 ? 'über 10 h (Schwelle ab 2027)' : 'unter den Schwellwerten';
      const at = localMs(k.ist_start);
      return `Tour ${k.tourbezeichnung ?? '–'}${at != null ? ` am ${dateLong(at)}` : ''}: ${hours(h, 2)} IST, ${over}; ${num(st.elemente.rows().length)} Tourelemente. `
        + `Abrechenbar ${hours(k.netto_h, 2)} nach ${hours(k.pause_h, 2)} Pause, darin AZU ${hours(k.azu_h, 2)} und Fahrten ${hours(k.fahrt_h, 2)}. Der Plan steht nur als Kontext darüber (gestrichelt).`;
    },
  },
  {
    showcase: 'ac4',
    title: 'FiCo: der Monat mit den meisten unversendeten Änderungen',
    target: 'ac4-aenderungen',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac4');
      st.env.set(ctx.env);
      st.clearAll();
      st.pickMonth(null);
      await s.until(() => !st.kommKpi.loading() && st.kommKpi.result() != null, 'AC-4 Kommunikation');
      // rule: the Planmonat with the most shifts changed after acceptance and never re-sent to the person
      const best = argmax(st.kommKpi.rows().filter((r) => !r.ist_gesamt && r.planmonat), (r) => r.nach_nicht_versendet ?? 0);
      if (!best?.planmonat || !best.nach_nicht_versendet) return 'Kein Monat mit Änderungen nach der Akzeptanz.';
      ctx.ficoMonth = best.planmonat;
      st.pickMonth(best.planmonat);
      return `${monthLong(dayMs(`${best.planmonat}-01`)!)}: ${num(best.nach_geaendert)} von ${num(best.kommuniziert)} kommunizierten Schichten wurden nach der Akzeptanz geändert, `
        + `${num(best.nach_nicht_versendet)} davon nie neu an die Person versendet (${num(best.nach_neu_versendet)} neu versendet). «Akzeptiert» setzt CargoControl fast immer selbst.`;
    },
  },
  {
    showcase: 'ac4',
    title: 'Sein grösster Tourstandort',
    target: 'ac4-overview',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac4');
      if (!ctx.ficoMonth) return 'Kein Monat aus dem vorigen Schritt.';
      if (st.month() !== ctx.ficoMonth) st.pickMonth(ctx.ficoMonth);
      await s.until(() => !st.standorte.loading() && st.standorte.result()?.params['month']?.startsWith(ctx.ficoMonth!) === true, 'AC-4 Tourstandorte');
      // rule: the Tourstandort with the most tours in that month
      const big = argmax(st.standorte.rows().filter((r) => r.depot_sk), (r) => r.touren ?? 0);
      if (!big?.depot_sk) return 'Kein Tourstandort mit Touren in diesem Monat.';
      ctx.ficoStandort = big.depot_sk;
      st.pickStandort(big.depot_sk);
      return `${big.tourstandort} (${big.firma}): ${num(big.touren)} Touren, Fahranteil ${num((big.fahranteil ?? 0) * 100, 1)} %, `
        + `Ist bei ${num((big.ist_erfassung ?? 0) * 100, 1)} % der vergangenen Elemente. Gewählt als Tourstandort mit den meisten Touren im Monat.`;
    },
  },
  {
    showcase: 'ac4',
    title: 'Eine Tour mit Ist',
    target: '#ac4-tour',
    dwellMs: DWELL,
    async run(s, ctx) {
      const st = s.host('ac4');
      if (!ctx.ficoMonth || !ctx.ficoStandort) return 'Kein Tourstandort aus dem vorigen Schritt.';
      if (st.month() !== ctx.ficoMonth) st.pickMonth(ctx.ficoMonth);
      if (st.standort() !== ctx.ficoStandort) st.pickStandort(ctx.ficoStandort);
      await s.until(() => !st.touren.loading() && st.touren.result()?.params['standort'] === ctx.ficoStandort, 'AC-4 Touren');
      // rule: the tour with the most elements that carry Ist (ties: the longer tour)
      const pick = argmax(st.touren.rows().filter((r) => (r.elemente_mit_ist ?? 0) > 0), (r) => (r.elemente_mit_ist ?? 0) * 1000 + (r.tourelemente ?? 0));
      if (!pick) return 'An diesem Tourstandort hat im Monat keine Tour ein Ist.';
      st.tour.set(pick.tour_id);
      await s.until(() => !st.tourQ.loading() && st.tourQ.result()?.params['tour'] === pick.tour_id, 'AC-4 Tour');
      const h = st.tourQ.rows()[0];
      const anger = h?.anger_min == null ? 'keine angerechnete Zeit geliefert' : `angerechnet ${num(h.anger_min / 60, 1)} h`;
      return `Tour ${h?.tour ?? ''} am ${dateLong(dayMs(h?.tour_planbeginn ?? null)!)}: ${num(pick.elemente_mit_ist)} von ${num(pick.tourelemente)} Elementen mit Ist `
        + `(«${h?.abdeckung ?? '–'}»), ${anger}. Der Ist-Zeitraum der Tour ist aus den Elementen abgeleitet, nicht Dienstbeginn und -ende.`;
    },
  },
];

/** day (yyyy-MM-dd) -> trainees sharing a training order (dor_name) with this Ausbilder that day, from the month's plan */
function sameOrderTrainees(st: Ac1Store, ausbilder: string): Map<string, Set<string>> {
  const mine = new Map<string, Set<string>>();
  for (const r of st.monthTours.rows()) {
    if (r.person_sk === ausbilder && r.dor_name) (mine.get(r.date.slice(0, 10)) ?? mine.set(r.date.slice(0, 10), new Set()).get(r.date.slice(0, 10))!).add(r.dor_name);
  }
  const out = new Map<string, Set<string>>();
  for (const r of st.monthTours.rows()) {
    const d = r.date.slice(0, 10);
    if (!r.dor_name || !mine.get(d)?.has(r.dor_name) || !st.people().get(r.person_sk)?.audiences.has('auszubildende')) continue;
    (out.get(d) ?? out.set(d, new Set()).get(d)!).add(r.person_sk);
  }
  return out;
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
