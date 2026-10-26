import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ThemeService } from '../../../core/theme';
import { FONT_NUM } from '../../../core/tokens';
import { UiButton } from '../../../shared/ui';
import { Ac8Store } from '../data/store';

interface Chart { dispatchAction: (a: object) => void }

/**
 * View 10 - story mode: an echarts timeline over the weeks of the window. Play steps through the weeks
 * (autoplay); every view follows the week: KPI tiles switch to the week's figures, the Schichtuhr to the
 * week's staffed plan, the pipeline re-queries the week, the scatter and the calendar light the week, the
 * duty-plan diff zooms to it. A demo for the screen, not a dashboard function.
 */
@Component({
  selector: 'ac8-story-bar',
  imports: [NgxEchartsDirective, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ac8-story', '[class.is-on]': 'store.storyWeek() !== null' },
  template: `
    <div class="ac8-story-head">
      <ui-button (click)="toggle()" [pressed]="store.playing()">{{ store.playing() ? 'Anhalten' : 'Wochen abspielen' }}</ui-button>
      @if (store.storyWeek(); as w) {
        <span class="ac8-story-week">{{ w.label }}</span>
        <ui-button kind="ghost" (click)="stop()">Ganzes Fenster</ui-button>
      } @else {
        <span class="muted">Woche anklicken oder abspielen: alle Ansichten folgen der Woche.</span>
      }
    </div>
    <div echarts class="ac8-story-axis" [options]="options()" [theme]="theme.echartsTheme()" (chartInit)="init($any($event))"
         (chartTimelineChanged)="changed($any($event))" (chartTimelinePlayChanged)="played($any($event))"></div>
  `,
})
export class StoryBar {
  protected readonly store = inject(Ac8Store);
  protected readonly theme = inject(ThemeService);
  private chart: Chart | null = null;
  private shownIndex: number | null = null;

  constructor() {
    // a week set from outside (the shared story mode, D2) moves the timeline's checkpoint too
    effect(() => {
      const i = this.store.storyIndex();
      if (i != null && i !== this.shownIndex) this.chart?.dispatchAction({ type: 'timelineChange', currentIndex: i });
    });
  }

  protected readonly options = computed<EChartsCoreOption>(() => {
    const t = this.theme.tokens();
    const weeks = this.store.weeks();
    const start = untracked(() => this.store.storyIndex()) ?? 0;
    // baseOption.timeline as a literal does not satisfy echarts' ComponentOption typing (TS2345); runtime option per docs
    return <EChartsCoreOption>(<unknown>{
      baseOption: {
        timeline: {
          axisType: 'category', data: weeks.map((w) => w.label.replace('KW ', '')), currentIndex: start, autoPlay: false, playInterval: 2600, loop: false,
          left: 8, right: 8, top: 4, bottom: 0, symbol: 'roundRect', symbolSize: [10, 6],
          label: { color: t.muted, fontFamily: FONT_NUM, fontSize: 11, interval: 'auto' },
          lineStyle: { color: t.axis, width: 2 }, itemStyle: { color: t.axis },
          checkpointStyle: { color: t.ink, borderColor: t.surface, borderWidth: 2, symbolSize: 12, animationDuration: 400 },
          controlStyle: { showPlayBtn: false, showPrevBtn: true, showNextBtn: true, color: t.ink2, borderColor: t.ink2, itemSize: 16 },
          progress: { lineStyle: { color: t.ink2 }, itemStyle: { color: t.ink2 }, label: { color: t.ink } },
          emphasis: { label: { color: t.ink }, itemStyle: { color: t.ink2 } },
        },
      },
      options: weeks.map(() => ({})),
    });
  });

  protected init(c: Chart): void {
    this.chart = c;
  }
  protected changed(e: { currentIndex: number }): void {
    this.shownIndex = e.currentIndex;
    this.store.storyIndex.set(e.currentIndex);
  }
  protected played(e: { playState: boolean }): void {
    this.store.playing.set(!!e.playState);
  }
  protected toggle(): void {
    const play = !this.store.playing();
    if (play && this.store.storyIndex() == null) {
      this.store.storyIndex.set(0);
      this.chart?.dispatchAction({ type: 'timelineChange', currentIndex: 0 });
    }
    this.chart?.dispatchAction({ type: 'timelinePlayChange', playState: play });
    this.store.playing.set(play);
  }
  protected stop(): void {
    this.chart?.dispatchAction({ type: 'timelinePlayChange', playState: false });
    this.store.resetStory();
  }
}
