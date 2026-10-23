import { Routes } from '@angular/router';

/** AC-7 feature routes (owned by the AC-7 session). Mounted under /ac7 by app.routes.ts. */
export const routes: Routes = [
  { path: '', title: 'AC-7 Verleihliste RT&S', loadComponent: () => import('./ac7-page').then((m) => m.Ac7Page) },
];
