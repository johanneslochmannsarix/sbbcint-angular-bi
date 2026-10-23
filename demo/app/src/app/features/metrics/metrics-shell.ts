import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ENVS, Env, TENANTS, TENANT_LABEL, Tenant } from '../../core/api';
import { BLANK, dateTimeLU, isoToDisplay, num, utcMs } from '../../core/format';
import { HeaderSlot } from '../../core/header-slot';
import { MAX_WINDOW_DAYS, MetricsFilters, WindowSel } from './data/filters';
import { metricsQuery } from './data/query';
import { DataAsOf } from './data/rows';

const PRESETS = [7, 30, 90, 180, 365] as const;

/**
 * /metrics (option B, 2026-10-21): the three pages of the original metrics spike over sm_platform_metrics,
 * moved into the demo. This shell puts the page tabs, the data-as-of stamp and the filters into the shell
 * header; the pages are its child routes. Ops telemetry, no person data.
 */
@Component({
  selector: 'app-metrics-shell',
  imports: [HeaderSlot, RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './metrics.css',
  template: `
    <ng-template appHeader>
      <div class="slot-row">
        <span class="slot-title">Plattform-Metriken</span>
        <nav class="seg seg-sm metrics-nav" aria-label="Metrics pages">
          <a routerLink="anatomy" routerLinkActive="is-active" ariaCurrentWhenActive="page">Run anatomy</a>
          <a routerLink="trend" routerLinkActive="is-active" ariaCurrentWhenActive="page">Trend and Pareto</a>
          <a routerLink="stability" routerLinkActive="is-active" ariaCurrentWhenActive="page">Step stability</a>
        </nav>
        <div class="asof" [title]="'Last collector run (fact_collector_run). ' + asOfAge()">
          <span class="asof-label">Data as of</span>
          <span class="asof-value">{{ asOfText() }}</span>
          @if (asOfAge()) {
            <span class="asof-age">{{ asOfAge() }}</span>
          }
          @if (collectorErrors() > 0) {
            <span class="asof-warn"><span class="status-icon status-serious" aria-hidden="true"></span>{{ collectorErrors() }} collector errors</span>
          }
        </div>
      </div>
    </ng-template>
    <ng-template appHeader="sub">
      <div class="filter-row" role="group" aria-label="Filters for every chart on this page">
        <div class="field">
          <span class="field-label" id="lbl-tenant">Tenant</span>
          <div class="seg" role="group" aria-labelledby="lbl-tenant">
            <button type="button" [attr.aria-pressed]="tenantPressed('ALL')" [disabled]="tenantDisabled('ALL')" (click)="f.setTenant('ALL')">All</button>
            @for (t of tenants; track t) {
              <button type="button" [attr.aria-pressed]="tenantPressed(t)" (click)="f.setTenant(t)">{{ tenantLabel[t] }}</button>
            }
          </div>
        </div>
        <div class="field">
          <span class="field-label" id="lbl-env">Environment</span>
          <div class="seg" role="group" aria-labelledby="lbl-env">
            <button type="button" [attr.aria-pressed]="envPressed('ALL')" [disabled]="envDisabled('ALL')" (click)="f.setEnv('ALL')">All</button>
            @for (e of envs; track e) {
              <button type="button" [attr.aria-pressed]="envPressed(e)" (click)="f.setEnv(e)">{{ e }}</button>
            }
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="win">Window</label>
          <select id="win" class="select" [value]="windowValue()" (change)="onWindow($any($event.target).value)">
            <option value="default">Page default ({{ f.rules().defaultDays }} days)</option>
            @for (d of presets; track d) {
              <option [value]="d">Last {{ d }} days</option>
            }
            <option value="custom">Custom range</option>
          </select>
        </div>
        @if (windowValue() === 'custom') {
          <div class="field field-custom">
            <label class="field-label" for="from">From</label>
            <input id="from" type="date" class="select" [value]="customFrom()" (input)="customFrom.set($any($event.target).value)" />
            <label class="field-label" for="to">to</label>
            <input id="to" type="date" class="select" [value]="customTo()" (input)="customTo.set($any($event.target).value)" />
            <button type="button" class="btn" (click)="applyCustom()">Apply</button>
            <span class="hint">At most {{ maxDays }} days; the backend rejects longer windows.</span>
          </div>
        }
        <p class="window-text">{{ isoToDisplay(f.dates().from) }} to {{ isoToDisplay(f.dates().to) }}, {{ f.windowDays() }} days</p>
      </div>
      @if (forcedNote()) {
        <p class="forced-note"><span class="info-icon" aria-hidden="true">i</span>{{ forcedNote() }}</p>
      }
    </ng-template>
    <router-outlet />
  `,
})
export class MetricsShell {
  protected readonly f = inject(MetricsFilters);
  protected readonly tenants = TENANTS;
  protected readonly envs = ENVS;
  protected readonly tenantLabel = TENANT_LABEL;
  protected readonly presets = PRESETS;
  protected readonly maxDays = MAX_WINDOW_DAYS;
  protected readonly isoToDisplay = isoToDisplay;

  protected readonly asOf = metricsQuery<DataAsOf>(() => ({ name: 'data_as_of', params: {} }));
  protected readonly asOfText = computed(() => {
    const r = this.asOf.rows()[0];
    if (!r) return this.asOf.error() ? 'unknown (data_as_of failed)' : BLANK;
    return dateTimeLU(utcMs(r.last_collected));
  });
  protected readonly asOfAge = computed(() => {
    const h = this.asOf.rows()[0]?.hours_since_collected;
    return h == null ? '' : `${num(h, 1)} h ago`;
  });
  protected readonly collectorErrors = computed(() => this.asOf.rows()[0]?.collector_errors ?? 0);

  protected readonly customFrom = signal('');
  protected readonly customTo = signal('');
  protected readonly windowValue = computed(() => {
    const w = this.f.window();
    return w.kind === 'default' ? 'default' : w.kind === 'days' ? String(w.days) : 'custom';
  });
  protected readonly forcedNote = computed(() => {
    const r = this.f.rules();
    return !r.tenantAll || !r.envAll ? (r.why ?? '') : '';
  });

  constructor() {
    effect(() => {
      const d = this.f.dates();
      untracked(() => {
        if (!this.customFrom()) this.customFrom.set(d.from);
        if (!this.customTo()) this.customTo.set(d.to);
      });
    });
  }

  protected tenantDisabled(t: Tenant | 'ALL'): boolean {
    return t === 'ALL' && !this.f.rules().tenantAll;
  }
  protected envDisabled(e: Env | 'ALL'): boolean {
    return e === 'ALL' && !this.f.rules().envAll;
  }
  protected tenantPressed(t: Tenant | 'ALL'): boolean {
    return t === 'ALL' ? this.f.tenant() === null : this.f.tenant() === t;
  }
  protected envPressed(e: Env | 'ALL'): boolean {
    return e === 'ALL' ? this.f.env() === null : this.f.env() === e;
  }

  protected onWindow(value: string): void {
    let w: WindowSel;
    if (value === 'default') w = { kind: 'default' };
    else if (value === 'custom') {
      const d = this.f.dates();
      this.customFrom.set(d.from);
      this.customTo.set(d.to);
      w = { kind: 'custom', from: d.from, to: d.to };
    } else w = { kind: 'days', days: Number(value) };
    this.f.window.set(w);
  }
  protected applyCustom(): void {
    const from = this.customFrom();
    const to = this.customTo();
    if (from && to) this.f.window.set({ kind: 'custom', from, to });
  }
}
