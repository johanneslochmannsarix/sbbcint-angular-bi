import { Routes } from '@angular/router';

/** AC-8 feature routes (owned by the AC-8 session). Mounted under /ac8 by app.routes.ts. */
export const routes: Routes = [
  { path: '', title: 'AC-8 Leitstand Olten', loadComponent: () => import('./ac8-page').then((m) => m.Ac8Page) },
];
