import { Routes } from '@angular/router';

/** AC-2 feature routes. Mounted under /ac2 by app.routes.ts. */
export const routes: Routes = [
  { path: '', title: 'AC-2 Qualifikationen', loadComponent: () => import('./ac2-page').then((m) => m.Ac2Page) },
];
