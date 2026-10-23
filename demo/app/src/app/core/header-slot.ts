import { Directive, Injectable, OnDestroy, OnInit, TemplateRef, inject, input, signal } from '@angular/core';

/**
 * The header slot per feature. A feature page puts its selectors (tenant / env / audience / data-as-of)
 * into the shell header, not into its own body:
 *
 *   <ng-template appHeader> ... bindings evaluate in the page component ... </ng-template>
 *   <ng-template appHeader="sub"> a second header row (selection chips), optional </ng-template>
 *
 * The page imports HeaderSlot; the slot is cleared when the page is destroyed (route change).
 */
@Injectable({ providedIn: 'root' })
export class HeaderSlotService {
  readonly main = signal<TemplateRef<unknown> | null>(null);
  readonly sub = signal<TemplateRef<unknown> | null>(null);
}

@Directive({ selector: 'ng-template[appHeader]' })
export class HeaderSlot implements OnInit, OnDestroy {
  readonly row = input<'' | 'main' | 'sub'>('', { alias: 'appHeader' });
  private readonly tpl = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly slots = inject(HeaderSlotService);

  ngOnInit(): void {
    (this.row() === 'sub' ? this.slots.sub : this.slots.main).set(this.tpl);
  }

  ngOnDestroy(): void {
    if (this.slots.main() === this.tpl) this.slots.main.set(null);
    if (this.slots.sub() === this.tpl) this.slots.sub.set(null);
  }
}
