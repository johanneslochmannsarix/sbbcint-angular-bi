import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { isPseudonym } from '../../core/api';
import { StoryService } from '../../story/story';
import { HeaderSlot } from '../../core/header-slot';
import { localStamp } from '../../core/format';
import { ENVS, Env, TENANTS, TENANT_LABEL, Tenant } from './data/api';
import { DataStore } from './data/model';
import { SelectionService } from './data/selection';
import { CalendarView } from './views/calendar';
import { CoverageView } from './views/coverage';
import { HeatmapView } from './views/heatmap';
import { HistogramView } from './views/histogram';
import { KpisView } from './views/kpis';
import { PersonDrawer } from './views/person-drawer';
import { SankeyView } from './views/sankey';
import { SwimlanesView } from './views/swimlanes';

/**
 * The AC-2 page (was ac2/app/src/app/app.ts). The tenant / env selector, data-as-of and the selection chips
 * moved into the shell header slots; theme toggle, masking chip and call counters are the shell's now.
 */
@Component({
  selector: 'app-ac2-page',
  imports: [HeaderSlot, KpisView, HeatmapView, CalendarView, SwimlanesView, CoverageView, HistogramView, SankeyView, PersonDrawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './ac2-page.html',
  styleUrl: './ac2.css',
})
export class Ac2Page {
  protected readonly store = inject(DataStore);
  protected readonly sel = inject(SelectionService);
  protected readonly tenants = TENANTS;
  protected readonly envs = ENVS;
  protected readonly tenantLabel = (t: Tenant) => TENANT_LABEL[t];

  protected readonly asOf = computed(() => localStamp(this.store.asOf.rows()[0]?.datenstand_local));
  protected readonly focusName = computed(() => {
    const q = this.sel.qualification();
    return q ? (this.store.model()?.qualBySk.get(q)?.name ?? null) : null;
  });

  /** Cross-link entry (D2): /ac2?tenant=RTS|CARGOCONTROL&env=PROD|QA&person=P-xxxxxx opens that person's drawer.
   *  Query params bind to these inputs (withComponentInputBinding); they are dropped from the URL once applied. */
  readonly tenant = input<string>();
  readonly env = input<string>();
  readonly person = input<string>();

  constructor() {
    const router = inject(Router);
    // shared story mode (D2): the story reads and sets this page's state while the page is shown
    inject(DestroyRef).onDestroy(inject(StoryService).register('ac2', { store: this.store, sel: this.sel }));
    effect(() => {
      const p = this.person();
      const t = this.tenant() as Tenant;
      const e = this.env() as Env;
      if (!isPseudonym(p) || !TENANTS.includes(t) || !ENVS.includes(e)) return;
      untracked(() => {
        this.sel.openPerson(p, t, e);
        void router.navigate([], { queryParams: {}, replaceUrl: true });
      });
    });
  }

  protected setTenant(t: Tenant): void {
    this.store.tenant.set(t);
  }
  protected setEnv(e: Env): void {
    this.store.env.set(e);
  }
}
