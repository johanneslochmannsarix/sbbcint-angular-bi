import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService, Env, MaskedPerson, Mode, isPseudonym } from '../../../core/api';
import { addDays, dayMs, isoDay, today } from '../../../core/format';
import { queryFactory } from '../../../core/query';
import {
  DienstplanRow, KpiRow, PersonRow, PipelineRow, PlanningRow, RiverRow, ShiftRow, ShiftVersionRow, SollRow, StandRow, VersionRow,
} from './types';
import { StandKey } from './palette';

export type Worker = 'alle' | 'disponent' | 'andere';
export const WORKER_LABEL: Record<Worker, string> = { disponent: 'Disponent Leitstelle', andere: 'Andere', alle: 'Alle' };

/** A brush on the lead-time scatter: versions created in [from, to] (days) with lead time in [leadMin, leadMax] h. */
export interface Brush {
  from: string;
  to: string;
  leadMin: number;
  leadMax: number;
}

export interface Week {
  from: string;
  to: string;
  label: string;
}

const q = queryFactory('ac8');

function monday(ms: number): number {
  const d = new Date(ms);
  return addDays(ms, -((d.getDay() + 6) % 7));
}

/**
 * The AC-8 page state: filters, the shared selection that links every view, and the named queries. Provided
 * by Ac8Page (one per visit). Nothing here computes a business number: counts come from the model's
 * _Kennzahlen measures; the app filters lists and lays out.
 */
@Injectable()
export class Ac8Store {
  private readonly api = inject(ApiService);

  // ---------------------------------------------------------------- filters
  readonly env = signal<Env>('PROD');
  readonly worker = signal<Worker>('disponent');
  /** Monday-aligned window; default 4 weeks back, 8 weeks ahead. */
  readonly from = signal(isoDay(addDays(monday(today()), -28)));
  readonly to = signal(isoDay(addDays(monday(today()), 8 * 7 - 1)));
  readonly planningPick = signal<string | null>(null);
  readonly riverSerie = signal<'status' | 'art'>('status');

  // ---------------------------------------------------------------- shared selection (linking)
  /** a communication state picked on a KPI tile or a pipeline node: filters lists, scatter, diff */
  readonly focus = signal<StandKey | null>(null);
  readonly brush = signal<Brush | null>(null);
  /** the shift whose versions view 7 shows */
  readonly shift = signal<string | null>(null);
  /** a person picked in the duty-plan diff */
  readonly person = signal<string | null>(null);
  /** a pipeline flow whose shifts the drawer lists */
  readonly flow = signal<{ title: string; stand: string; rueckmeldung?: string | null; weichtAb?: boolean | null } | null>(null);

  // ---------------------------------------------------------------- story mode
  readonly storyIndex = signal<number | null>(null);
  readonly playing = signal(false);

  readonly weeks = computed<Week[]>(() => {
    const out: Week[] = [];
    const end = dayMs(this.to())!;
    for (let m = monday(dayMs(this.from())!); m <= end; m = addDays(m, 7)) {
      const to = addDays(m, 6);
      const d = new Date(m);
      out.push({ from: isoDay(m), to: isoDay(to), label: `KW ${isoWeek(d)}` });
    }
    return out;
  });
  readonly storyWeek = computed(() => {
    const i = this.storyIndex();
    return i == null ? null : (this.weeks()[i] ?? null);
  });

  // ---------------------------------------------------------------- queries
  private readonly base = computed(() => ({ env: this.env() }));
  private readonly win = computed(() => ({ env: this.env(), date_from: this.from(), date_to: this.to() }));
  private readonly brushParams = computed(() => {
    const b = this.brush();
    return b ? { brush_from: b.from, brush_to: b.to, lead_min: String(b.leadMin), lead_max: String(b.leadMax) } : {};
  });

  readonly stand = q<StandRow>(() => ({ name: 'stand', params: this.base() }));
  readonly persons = q<PersonRow>(() => ({ name: 'persons', params: this.base() }));
  readonly plannings = q<PlanningRow>(() => ({ name: 'plannings', params: this.base() }));
  readonly kpiDay = q<KpiRow>(() => ({ name: 'kpi', params: { ...this.win(), grain: 'tag', worker: this.worker() } }));
  readonly kpiWeek = q<KpiRow>(() => ({ name: 'kpi', params: { ...this.win(), grain: 'woche', worker: this.worker() } }));
  readonly kpiWin = q<KpiRow>(() => ({ name: 'kpi', params: { ...this.win(), grain: 'fenster', worker: this.worker() } }));
  readonly pipeline = q<PipelineRow>(() => {
    const w = this.storyWeek();
    const win = w ? { env: this.env(), date_from: w.from, date_to: w.to } : this.win();
    return { name: 'pipeline', params: { ...win, worker: this.worker(), ...this.brushParams() } };
  });
  readonly river = q<RiverRow>(() => ({ name: 'river', params: { ...this.win(), serie: this.riverSerie(), ...this.brushParams() } }));
  readonly versions = q<VersionRow>(() => ({ name: 'versions', params: this.win() }));
  readonly shifts = q<ShiftRow>(() => ({ name: 'shifts', params: { ...this.win(), worker: this.worker() } }));
  readonly dienstplan = q<DienstplanRow>(() => ({ name: 'dienstplan', params: { ...this.win(), worker: this.worker() } }));
  readonly planning = computed(() => {
    const pick = this.planningPick();
    const rows = this.plannings.rows();
    if (pick && rows.some((r) => r.shift_planning_sk === pick)) return pick;
    return defaultPlanning(rows)?.shift_planning_sk ?? null;
  });
  readonly planningIsDefault = computed(() => this.planningPick() == null || this.planningPick() !== this.planning());
  readonly soll = q<SollRow>(() => {
    const p = this.planning();
    return p ? { name: 'soll', params: { ...this.base(), planning: p } } : null;
  });
  readonly shiftVersions = q<ShiftVersionRow>(() => {
    const s = this.shift() ?? this.defaultShift();
    return s ? { name: 'shift_versions', params: { ...this.base(), shift: s } } : null;
  });

  // ---------------------------------------------------------------- derived (lookups, no business numbers)
  readonly mode = computed<Mode>(() => this.api.mode() ?? 'masked');
  readonly personBy = computed(() => {
    const m = new Map<string, MaskedPerson>();
    const mode = this.persons.result()?.mode ?? 'masked';
    for (const r of this.persons.rows()) {
      if (isPseudonym(r.person_sk)) m.set(r.person_sk, { key: r.person_sk, label: r.person_name || null, mode });
    }
    return m;
  });
  person$(key: string | null): MaskedPerson | null {
    if (!key || !isPseudonym(key)) return null;
    return this.personBy().get(key) ?? { key, label: key, mode: 'masked' };
  }
  readonly shiftBy = computed(() => new Map(this.shifts.rows().map((r) => [r.shift_sk, r])));
  /** shifts whose state matches the focus (null = no focus) */
  readonly focusShifts = computed<Set<string> | null>(() => {
    const f = this.focus();
    if (!f) return null;
    if (f === 'gelöscht') return new Set(this.dienstplan.rows().filter((r) => r.dienstplan_quelle.startsWith('gelöscht')).map((r) => r.shift_sk));
    return new Set(this.shifts.rows().filter((r) => r.kommunikationsstand === f).map((r) => r.shift_sk));
  });
  /** default for view 7 until something is picked: the window's shift with the most versions */
  readonly defaultShift = computed(() => {
    const n = new Map<string, number>();
    for (const v of this.versions.rows()) n.set(v.shift_sk, (n.get(v.shift_sk) ?? 0) + 1);
    let best: string | null = null;
    let max = 0;
    for (const [k, c] of n) if (c > max) [best, max] = [k, c];
    return best;
  });

  // ---------------------------------------------------------------- actions
  setWindowWeeks(back: number, ahead: number): void {
    const m = monday(today());
    this.from.set(isoDay(addDays(m, -7 * back)));
    this.to.set(isoDay(addDays(m, 7 * ahead - 1)));
    this.resetStory();
  }
  setWholePlan(): void {
    const s = this.stand.rows()[0];
    if (!s?.erster_plantag || !s.letzter_plantag) return;
    const a = monday(dayMs(s.erster_plantag)!);
    const b = dayMs(s.letzter_plantag)!;
    const days = Math.min(Math.round((b - a) / 86_400_000), 399);
    this.from.set(isoDay(a));
    this.to.set(isoDay(addDays(a, days)));
    this.resetStory();
  }
  resetStory(): void {
    this.playing.set(false);
    this.storyIndex.set(null);
  }
  clearSelection(): void {
    this.focus.set(null);
    this.brush.set(null);
    this.person.set(null);
    this.flow.set(null);
  }
}

/** The model has no validity dates for its planning variants: pick «… ab August» if present, else the largest. */
export function defaultPlanning(rows: PlanningRow[]): PlanningRow | null {
  const cco = rows.filter((r) => (r.soll ?? 0) > 5);
  return cco.find((r) => /ab August/i.test(r.planning_name ?? '')) ?? [...cco].sort((a, b) => (b.soll ?? 0) - (a.soll ?? 0))[0] ?? null;
}

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
}
