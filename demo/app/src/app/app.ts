import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { EMPTY, catchError, debounceTime, startWith, switchMap } from 'rxjs';
import { ApiService, Health } from './core/api';
import { HeaderSlotService } from './core/header-slot';
import { ThemeService } from './core/theme';
import { StoryPanel } from './story/story-panel';

/** The shell: brand, showcase tabs, the active feature's header slot, masking state, theme, call counters. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgTemplateOutlet, StoryPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
})
export class App {
  protected readonly theme = inject(ThemeService);
  protected readonly api = inject(ApiService);
  protected readonly slot = inject(HeaderSlotService);
  protected readonly health = signal<Health | null>(null);
  protected readonly healthDown = signal(false);

  constructor() {
    // event-driven: once at start, then only after this tab caused a Fabric call (no timer, no polling)
    toObservable(this.api.fabricCalls)
      .pipe(
        startWith(0),
        debounceTime(1500),
        switchMap(() =>
          this.api.health().pipe(
            catchError(() => {
              this.healthDown.set(true);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((h) => {
        this.healthDown.set(false);
        this.health.set(h);
      });
  }
}
