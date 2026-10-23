import { Routes } from '@angular/router';

/** AC-1 feature routes (owned by the AC-1 session). Mounted under /ac1 by app.routes.ts. */
export const routes: Routes = [
  { path: '', title: 'AC-1 Plantafel', loadComponent: () => import('./ac1-page').then((m) => m.Ac1Page) },
];
