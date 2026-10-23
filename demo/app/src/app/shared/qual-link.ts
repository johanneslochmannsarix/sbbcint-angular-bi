import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Env, Tenant } from '../core/api';

/**
 * Cross-link to AC-2: a person's qualifications (D2 2026-10-21). Carries the pseudonym only; AC-2 resolves it
 * server side (person_detail), so it works only within one backend process (run.ps1, port 8765) - a dev
 * backend per showcase has its own key. A pseudonym AC-2 cannot resolve shows «keine Qualifikationsdaten».
 *
 * Tenant is the person's own pool: RT&S persons (AC-1) link to AC-2 RT&S, Leitstelle Olten persons (AC-8)
 * to AC-2 CargoControl (person_sk matches 100 %, probes/d2/person_key_match.py). Never across pools: there is
 * no cross-pool person id.
 */
export function qualLinkParams(tenant: Tenant, env: Env, person: string): Record<string, string> {
  return { tenant, env, person };
}

@Component({
  selector: 'app-qual-link',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<a class="qual-link" routerLink="/ac2" [queryParams]="params()" [title]="title()">{{ text() }}</a>`,
  styles: [`
    .qual-link { font-size: 12px; color: var(--accent); text-decoration: none; white-space: nowrap; }
    .qual-link:hover, .qual-link:focus-visible { text-decoration: underline; }
  `],
})
export class QualLink {
  readonly person = input.required<string>();
  readonly tenant = input.required<Tenant>();
  readonly env = input.required<Env>();
  readonly text = input('Qualifikationen ›');

  protected readonly params = computed(() => qualLinkParams(this.tenant(), this.env(), this.person()));
  protected readonly title = computed(() => `Qualifikationen dieser Person in AC-2 (${this.tenant() === 'RTS' ? 'RT&S' : 'CargoControl'}, ${this.env()})`);
}
