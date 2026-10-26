import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideEchartsCore } from 'ngx-echarts';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    // SBB components (sbb variant, core/style.ts) use @angular/animations triggers; the renderer loads lazily
    // (https://angular.dev/api/platform-browser/animations/async/provideAnimationsAsync, deprecated since 20.2)
    provideAnimationsAsync(),
    provideRouter(routes, withComponentInputBinding()),
    // lazy: echarts loads with the first chart, not with the shell
    provideEchartsCore({ echarts: () => import('./core/echarts-setup') }),
  ],
};
