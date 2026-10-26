import { provideHttpClient } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { StyleService } from '../../core/style';
import { UiButton, UiDate, UiOption, UiSeg, UiSelect, UiTable } from './index';

/** The variant branch of every shared control: demo = today's markup, sbb = the SBB component. */
@Component({
  imports: [UiSeg, UiSelect, UiButton, UiDate, UiTable],
  template: `
    <ui-seg id="seg2" ariaLabel="Umgebung" [options]="two" [value]="env()" (valueChange)="env.set($event)" />
    <ui-seg id="seg5" ariaLabel="Vorlagen" [options]="five" [value]="null" (valueChange)="picked.set($event)" />
    <ui-seg id="act" [actions]="true" [options]="arrows" (valueChange)="picked.set($event)" />
    <ui-select ariaLabel="Kohorte" [options]="opts" [value]="sel()" (valueChange)="sel.set($event)" />
    <ui-button kind="ghost" label="Vorherige Woche" (click)="clicks.set(clicks() + 1)">‹</ui-button>
    <ui-date inputId="from" [value]="day()" (valueChange)="day.set($event)" />
    <table class="tbl" uiTable><tbody><tr><td>1</td></tr></tbody></table>
  `,
})
class Host {
  readonly two: UiOption<string>[] = [{ value: 'PROD', label: 'PROD' }, { value: 'QA', label: 'QA' }];
  readonly five: UiOption<string>[] = ['a', 'b', 'c', 'd', 'e'].map((v) => ({ value: v, label: v.toUpperCase() }));
  readonly arrows: UiOption<number>[] = [{ value: -1, label: '‹', ariaLabel: 'zurück' }, { value: 1, label: '›', ariaLabel: 'vor' }];
  readonly opts = [{ value: '', label: 'alle' }, { value: 'x', label: 'X' }];
  readonly env = signal('PROD');
  readonly picked = signal<unknown>(null);
  readonly sel = signal('x');
  readonly day = signal('2026-10-24');
  readonly clicks = signal(0);
}

async function render(variant: 'demo' | 'sbb') {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideNoopAnimations()] });
  TestBed.inject(StyleService).set(variant);
  const f = TestBed.createComponent(Host);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, host: f.componentInstance };
}

describe('shared/ui', () => {
  // jsdom has no matchMedia; SbbCommonModule (built with the standalone injector even in the demo variant) and
  // ThemeService read it
  beforeAll(() => {
    window.matchMedia ??= ((q: string) =>
      ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) as MediaQueryList);
  });
  afterEach(() => TestBed.inject(StyleService).set('demo'));

  it('demo variant renders today\'s markup', async () => {
    const { f, el, host } = await render('demo');
    const seg = el.querySelector('#seg2 .seg[role=group]')!;
    expect(seg.getAttribute('aria-label')).toBe('Umgebung');
    expect([...seg.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    (seg.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(host.env()).toBe('QA');
    expect(el.querySelector('#act button')!.hasAttribute('aria-pressed')).toBe(false);
    const select = el.querySelector('select.select') as HTMLSelectElement;
    expect(select.value).toBe('x');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(host.sel()).toBe('');
    const btn = el.querySelector('button.btn.btn-ghost') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Vorherige Woche');
    btn.click();
    expect(host.clicks()).toBe(1);
    expect((el.querySelector('input[type=date].select') as HTMLInputElement).value).toBe('2026-10-24');
    expect(el.querySelector('table')!.classList.contains('sbb-table')).toBe(false);
    expect(el.querySelector('sbb-toggle, sbb-select, sbb-datepicker, [sbb-button], [sbb-secondary-button]')).toBeNull();
    f.destroy();
  });

  it('sbb variant renders the SBB components', async () => {
    const { f, el, host } = await render('sbb');
    expect(el.querySelector('.seg')).toBeNull();
    expect(el.querySelector('#seg2 sbb-toggle')).not.toBeNull();
    expect(el.querySelectorAll('#seg2 sbb-toggle-option').length).toBe(2);
    // five options without a pressed one: a button row, nothing primary
    expect(el.querySelectorAll('#seg5 [sbb-secondary-button]').length).toBe(5);
    expect(el.querySelector('#seg5 [sbb-button]')).toBeNull();
    (el.querySelectorAll('#act [sbb-secondary-button]')[1] as HTMLButtonElement).click();
    expect(host.picked()).toBe(1);
    expect(el.querySelector('sbb-form-field sbb-select')).not.toBeNull();
    expect(el.querySelector('select.select')).toBeNull();
    const ghost = el.querySelector('[sbb-ghost-button]') as HTMLButtonElement;
    ghost.click();
    expect(host.clicks()).toBe(1);
    expect(el.querySelector('sbb-datepicker input[sbbDateInput]')).not.toBeNull();
    expect(el.querySelector('table')!.classList.contains('sbb-table')).toBe(true);
    expect(host.env()).toBe('PROD'); // the toggle's own initial selection is not reported back
    f.destroy();
  });
});
