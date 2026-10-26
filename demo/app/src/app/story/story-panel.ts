import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UiButton } from '../shared/ui';
import { StoryService } from './story';

/**
 * The story controls, fixed at the bottom of the shell while a story runs: step n of N, title, what to say,
 * back / pause-play / next / end. Keys: ← back, → next, space pause/play, Esc end.
 */
@Component({
  selector: 'app-story-panel',
  imports: [UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'story-panel',
    role: 'region',
    'aria-label': 'Story-Modus',
    '(document:keydown)': 'key($event)',
  },
  template: `
    @if (story.step(); as s) {
      <div class="story-progress" aria-hidden="true">
        @for (x of story.steps; track $index) {
          <span class="story-dot" [class.is-done]="$index < story.index()!" [class.is-on]="$index === story.index()"></span>
        }
      </div>
      <div class="story-body">
        <p class="story-kicker">Story {{ story.index()! + 1 }} / {{ story.steps.length }} · {{ s.showcase.toUpperCase() }}</p>
        <h2 class="story-title">{{ s.title }}</h2>
        @if (story.error(); as e) {
          <p class="story-text story-error" role="alert">{{ e }}</p>
        } @else if (story.busy()) {
          <p class="story-text muted"><span class="spinner" aria-hidden="true"></span> Lädt …</p>
        } @else {
          <p class="story-text" aria-live="polite">{{ story.caption() }}</p>
        }
      </div>
      <div class="story-ctl">
        <ui-button (click)="story.back()" [disabled]="story.index() === 0" label="Zurück">‹ Zurück</ui-button>
        <ui-button (click)="story.togglePlay()" [pressed]="story.playing()">{{ story.playing() ? 'Pause' : 'Abspielen' }}</ui-button>
        <ui-button (click)="story.next()" [disabled]="story.index() === story.steps.length - 1" label="Weiter">Weiter ›</ui-button>
        <ui-button kind="ghost" (click)="story.stop()" label="Story beenden">Beenden</ui-button>
      </div>
    }
  `,
  styles: [`
    :host { position: fixed; left: 16px; bottom: 16px; width: min(620px, calc(100vw - 32px)); z-index: 60; display: block; pointer-events: none; }
    :host:empty { display: none; }
    .story-progress, .story-body, .story-ctl { pointer-events: auto; }
    .story-progress { display: flex; gap: 4px; padding: 10px 16px 0; background: var(--surface); border: 1px solid var(--rule); border-bottom: 0; border-radius: 8px 8px 0 0; }
    .story-dot { flex: 1; height: 3px; border-radius: 2px; background: var(--rule); }
    .story-dot.is-done { background: var(--muted); }
    .story-dot.is-on { background: var(--accent); }
    .story-body { padding: 8px 16px 4px; background: var(--surface); border-inline: 1px solid var(--rule); }
    .story-kicker { margin: 0; font-size: 11px; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
    .story-title { margin: 2px 0 4px; font-size: 16px; }
    .story-text { margin: 0; font-size: 13.5px; line-height: 1.45; min-height: 2.9em; }
    .story-error { color: var(--ink); }
    .story-ctl { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; padding: 8px 16px 12px; background: var(--surface);
      border: 1px solid var(--rule); border-top: 0; border-radius: 0 0 8px 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
    @media (max-width: 640px) { :host { left: 8px; bottom: 8px; width: calc(100vw - 16px); } .story-ctl { justify-content: stretch; } .story-ctl ::ng-deep .btn { flex: 1; } }
  `],
})
export class StoryPanel {
  protected readonly story = inject(StoryService);

  protected key(e: KeyboardEvent): void {
    if (!this.story.active()) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === 'ArrowRight') this.story.next();
    else if (e.key === 'ArrowLeft') this.story.back();
    else if (e.key === ' ') this.story.togglePlay();
    else if (e.key === 'Escape') this.story.stop();
    else return;
    e.preventDefault();
  }
}
