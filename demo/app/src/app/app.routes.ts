import { Routes } from '@angular/router';

/**
 * Shell-owned. Each showcase is a lazy feature with its own routes file (features/<ac>/routes.ts), which
 * its session owns; nothing here changes when a feature grows. /metrics = the platform-metrics pages (option B).
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', title: 'Demo', loadComponent: () => import('./start/start-page').then((m) => m.StartPage) },
  { path: 'ac1', loadChildren: () => import('./features/ac1/routes').then((m) => m.routes) },
  { path: 'ac2', loadChildren: () => import('./features/ac2/routes').then((m) => m.routes) },
  { path: 'ac8', loadChildren: () => import('./features/ac8/routes').then((m) => m.routes) },
  { path: 'ac4', loadChildren: () => import('./features/ac4/routes').then((m) => m.routes) },
  { path: 'ac10', loadChildren: () => import('./features/ac10/routes').then((m) => m.routes) },
  { path: 'ac6', loadChildren: () => import('./features/ac6/routes').then((m) => m.routes) },
  { path: 'ac7', loadChildren: () => import('./features/ac7/routes').then((m) => m.routes) },
  { path: 'ac9', loadChildren: () => import('./features/ac9/routes').then((m) => m.routes) },
  { path: 'ac13', loadChildren: () => import('./features/ac13/routes').then((m) => m.routes) },
  { path: 'metrics', loadChildren: () => import('./features/metrics/routes').then((m) => m.routes) },
  { path: '**', redirectTo: '' },
];
