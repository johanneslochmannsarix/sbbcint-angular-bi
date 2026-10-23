import { Routes } from '@angular/router';

/** AC-9 feature routes (owned by the AC-9 session). Mounted under /ac9 by app.routes.ts. */
export const routes: Routes = [
  { path: '', title: 'AC-9 Rechnungslegung RT&S', loadComponent: () => import('./ac9-page').then((m) => m.Ac9Page) },
];
