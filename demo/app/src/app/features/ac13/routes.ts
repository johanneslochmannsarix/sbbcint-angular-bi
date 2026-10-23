import { Routes } from '@angular/router';

/** AC-13 feature routes (owned by the AC-13 session). Mounted under /ac13 by app.routes.ts. */
export const routes: Routes = [
  { path: '', title: 'AC-13 Nachbereitung SBB CD', loadComponent: () => import('./ac13-page').then((m) => m.Ac13Page) },
];
