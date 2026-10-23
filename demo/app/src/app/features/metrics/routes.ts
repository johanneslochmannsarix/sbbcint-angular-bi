import { Routes } from '@angular/router';
import { PageRules } from './data/filters';

const ONE_SCOPE = 'their measures are blank unless exactly one tenant/env (env_key) is in context';

/** /metrics feature routes (option B, 2026-10-21). Mounted under /metrics by app.routes.ts. */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./metrics-shell').then((m) => m.MetricsShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'anatomy' },
      {
        path: 'anatomy',
        title: 'Metrics: Run anatomy',
        loadComponent: () => import('./pages/anatomy').then((m) => m.AnatomyPage),
        data: {
          rules: {
            title: 'Run anatomy',
            tenantAll: true,
            envAll: false,
            defaultDays: 30,
            why: 'Run anatomy needs one environment: every anatomy query requires env.',
          } satisfies PageRules,
        },
      },
      {
        path: 'trend',
        title: 'Metrics: Trend and Pareto',
        loadComponent: () => import('./pages/trend').then((m) => m.TrendPage),
        data: {
          rules: {
            title: 'Trend and Pareto',
            tenantAll: false,
            envAll: false,
            defaultDays: 90,
            why: `The Pareto panel and the batch table need one tenant and one environment: ${ONE_SCOPE}. The two size trends still show all environments / all tenants as their series. Only delivered batches count (is_delivered: done/ before the ADR-056 landing layout, processed/…-done since; superseded and failed excluded).`,
          } satisfies PageRules,
        },
      },
      {
        path: 'stability',
        title: 'Metrics: Step stability',
        loadComponent: () => import('./pages/stability').then((m) => m.StabilityPage),
        data: {
          rules: {
            title: 'Step stability',
            tenantAll: false,
            envAll: false,
            defaultDays: 90,
            why: `Step stability needs one tenant and one environment: ${ONE_SCOPE}.`,
          } satisfies PageRules,
        },
      },
      { path: '**', redirectTo: 'anatomy' },
    ],
  },
];
