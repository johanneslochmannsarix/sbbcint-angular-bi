import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MaskedPerson, personText } from '../core/api';

/**
 * One person as a chip. Masked: the pseudonym P-xxxxxx (random key per backend start). Real (-Real only):
 * the name, with the pseudonym in the title. No name in the source: "P-xxxxxx (ohne Namen)", shown, never
 * hidden. Clickable when (pick) is bound: it emits the pseudonym, the only handle features pass around.
 */
@Component({
  selector: 'app-pseudonym',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pseudo',
    '[class.pseudo-real]': "person().mode === 'real'",
    '[class.pseudo-noname]': 'person().label == null',
    '[attr.title]': 'title()',
    '[attr.role]': "clickable() ? 'button' : null",
    '[attr.tabindex]': 'clickable() ? 0 : null',
    '(click)': 'emit()',
    '(keydown.enter)': 'emit()',
  },
  template: `<span class="pseudo-dot" aria-hidden="true"></span>{{ text() }}`,
})
export class PseudonymChip {
  readonly person = input.required<MaskedPerson>();
  readonly clickable = input(false);
  readonly pick = output<string>();

  readonly text = computed(() => personText(this.person()));
  readonly title = computed(() => {
    const p = this.person();
    if (p.mode === 'real') return `Klarname (Backend mit -Real gestartet). Pseudonym ${p.key}`;
    return 'Pseudonym: zufälliger Schlüssel je Backend-Start, gleich in allen Showcases dieses Backends.';
  });

  emit(): void {
    if (this.clickable()) this.pick.emit(this.person().key);
  }
}
