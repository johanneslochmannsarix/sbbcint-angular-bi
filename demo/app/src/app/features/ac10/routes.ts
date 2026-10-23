import { Routes } from '@angular/router';

/** AC-10 feature routes (owned by the AC-10 session). Mounted under /ac10 by app.routes.ts. */
export const routes: Routes = [
  { path: '', title: 'AC-10 Offene Schichten', loadComponent: () => import('./ac10-page').then((m) => m.Ac10Page) },
];
