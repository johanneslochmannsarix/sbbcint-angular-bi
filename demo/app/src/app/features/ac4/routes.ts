import { Routes } from '@angular/router';

/** AC-4 feature routes (owned by the AC-4 session). Mounted under /ac4 by app.routes.ts. */
export const routes: Routes = [
  { path: '', title: 'AC-4 FiCo Produktivität', loadComponent: () => import('./ac4-page').then((m) => m.Ac4Page) },
];
