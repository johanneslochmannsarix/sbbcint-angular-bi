import { Directive, computed, inject } from '@angular/core';
import { StyleService } from '../../core/style';

/**
 * A data table (`table.tbl`): `<table class="tbl" uiTable>`. The demo's tables keep their hand-written rows
 * (click handlers, marks, colspans); sbb-table's CDK form (table.md: dataSource + column defs) would rebuild
 * every one of them. In the sbb variant the table also gets SBB's `sbb-table` class, whose cell styles ship in
 * typography.css (layer sbb); styles-sbb.css lets them through the demo's .tbl cell rules.
 */
@Directive({
  selector: 'table[uiTable]',
  host: { '[class.sbb-table]': 'sbb()' },
})
export class UiTable {
  private readonly style = inject(StyleService);
  protected readonly sbb = computed(() => this.style.variant() === 'sbb');
}
