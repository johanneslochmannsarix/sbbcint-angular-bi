import { Routes } from '@angular/router';

/** AC-6 feature routes (owned by the AC-6 session). Mounted under /ac6 by app.routes.ts. */
export const routes: Routes = [
  { path: '', title: 'AC-6 JUP Planung', loadComponent: () => import('./ac6-page').then((m) => m.Ac6Page) },
];
