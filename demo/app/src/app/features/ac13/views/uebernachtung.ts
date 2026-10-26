import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { personOf } from '../../../core/api';
import { dateOnly, localMs, num, timeLocal } from '../../../core/format';
import { ThemeService } from '../../../core/theme';
import { ChartCard } from '../../../shared/chart-card';
import { ChartResize } from '../../../shared/chart-resize';
import { PseudonymChip } from '../../../shared/pseudonym-chip';
import { ariaDecal, ttHead, ttRow } from '../../../shared/chart-opts';
import { UiButton } from '../../../shared/ui';
import { ac13Colors } from '../data/palette';
import { Ac13Store } from '../data/store';
import { UeRow } from '../data/types';

const t = (v: string | null) => (v ? timeLocal(localMs(v)!) : '–');

/**
 * View 3 - «Übernachtungstouren DE»: where do the overnight legs go, how often, and which two tours form a pair?
 * Rule v1-ziel_ungleich_start (staffed tour ending at another Betriebsstelle than it starts; BOTH legs flagged),
 * pair attribute v1-folgetour-zielort (Hinweg / Folgetour, next tour of the same person at the Zielort within
 * 0–24 h). Graph = stations (shortcodes) and directed edges weighted by legs (force layout, layout only; no map:
 * the station master carries no coordinates the demo may read, README). Edge click = the leg list of that edge;
 * a leg opens its pair (the partner found by person + partner begin among the returned legs; a partner in
 * another month is shown from the leg's own attributes).
 */
@Component({
  selector: 'ac13-uebernachtung',
  styleUrl: './uebernachtung.css',
  encapsulation: ViewEncapsulation.None,
  imports: [NgxEchartsDirective, ChartResize, ChartCard, PseudonymChip, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card heading="Wohin führen die Übernachtungstouren, und welche zwei Touren bilden ein Paar?" [q]="[store.kanten, store.ueTouren]"
              emptyNote="In dieser Auswahl endet keine besetzte Tour an einer anderen Betriebsstelle, als sie beginnt.">
      <p class="ac13-answer">{{ answer() }}</p>
      <div class="ac13-split">
        <div echarts class="chart" [style.height.px]="380" [options]="options()!" [theme]="theme.echartsTheme()" (chartClick)="click($any($event))"
             aria-label="Netz der Übernachtungstouren; Kante anklicken zeigt ihre Touren"></div>
        <div class="ac13-side">
          <div class="ac13-side-head">
            @if (store.edge(); as e) {
              <span>{{ e.start }} → {{ e.ziel }}: {{ n(legs().length) }} Touren</span>
              <button type="button" class="linkish" (click)="store.pickEdge(null)">alle Kanten</button>
            } @else {
              <span>Alle {{ n(legs().length) }} Übernachtungstouren des Monats</span>
            }
          </div>
          <div class="ac13-list ac13-list-tall">
            <table class="ac13-tbl">
              <thead><tr><th>Datum</th><th>Person</th><th>Tour</th><th>Start → Ziel</th><th>Rolle</th><th>Plan</th></tr></thead>
              <tbody>
                @for (r of shown(); track r.tour) {
                  <tr tabindex="0" [class.is-sel]="r.tour === store.leg() || r.tour === pair()?.partner?.tour"
                      (click)="store.pickLeg(r.tour)" (keydown.enter)="store.pickLeg(r.tour)">
                    <td>{{ d(r.datum) }}</td>
                    <td>@if (who(r); as p) { <app-pseudonym [person]="p" /> }</td>
                    <td>{{ r.tourennummer ?? '–' }}</td><td>{{ r.start }} → {{ r.ziel }}</td><td>{{ r.rolle ?? 'ohne Partner' }}</td>
                    <td>{{ t(r.plan_beginn) }}–{{ t(r.plan_ende) }}</td>
                  </tr>
                }
              </tbody>
            </table>
            @if (legs().length > shown().length) {
              <button type="button" class="linkish ac13-more" (click)="limit.set(limit() + 200)">weitere {{ n(legs().length - shown().length) }} anzeigen</button>
            }
          </div>
        </div>
      </div>
      @if (pair(); as pr) {
        <div class="ac13-pair" role="region" aria-label="Übernachtungspaar">
          @for (side of pr.sides; track side.label) {
            <div class="ac13-pair-side">
              <span class="ac13-pair-role">{{ side.label }}</span>
              <span class="ac13-pair-line">{{ d(side.datum) }}, {{ side.zeit }}: {{ side.weg }}</span>
              <span class="ac13-pair-sub">{{ side.tour ?? '–' }}{{ side.note }}</span>
              @if (side.sk) { <ui-button kind="ghost" (click)="store.openTour(side.sk)">Tour öffnen</ui-button> }
            </div>
          }
          <p class="ac13-pair-note">Übernachtungsort {{ pr.ort ?? '–' }}{{ pr.folgetag ? ', Folgetour am nächsten Kalendertag' : ', Folgetour am selben Tag' }}. Regel {{ store.stand.rows()[0]?.regel_paar ?? '' }}.</p>
        </div>
      }
      <p class="ac13-note">{{ store.stand.rows()[0]?.hinweis_uebernachtung ?? '' }} Kantenbreite = Touren; Pfeil = Richtung Start → Ziel. Betriebsstellen als Kürzel.</p>
    </app-card>
  `,
})
export class UebernachtungView {
  protected readonly store = inject(Ac13Store);
  protected readonly theme = inject(ThemeService);
  protected readonly n = (v: number | null) => num(v);
  protected readonly d = (v: string) => dateOnly(v);
  protected readonly t = t;

  protected who(r: UeRow) {
    return personOf(r as unknown as Record<string, unknown>, 'person', 'kennung', this.store.mode());
  }

  protected readonly legs = computed(() => {
    const e = this.store.edge();
    const rows = this.store.ueTouren.rows();
    return e ? rows.filter((r) => r.start === e.start && r.ziel === e.ziel) : rows;
  });

  /** rows rendered: the first 120 (598 legs in a busy month), more on demand; the selected leg is always shown */
  protected readonly limit = signal(120);
  protected readonly shown = computed(() => {
    const all = this.legs();
    const head = all.slice(0, this.limit());
    const sel = this.store.leg();
    const extra = sel && !head.some((r) => r.tour === sel) ? all.filter((r) => r.tour === sel) : [];
    return [...head, ...extra];
  });
  private readonly resetLimit = effect(() => {
    this.store.edge();
    this.store.month();
    this.limit.set(120);
  });

  protected readonly pair = computed(() => {
    const sk = this.store.leg();
    const rows = this.store.ueTouren.rows();
    const leg = sk ? rows.find((r) => r.tour === sk) : null;
    if (!leg) return null;
    const partner = leg.partner_beginn
      ? rows.find((r) => r.person === leg.person && r.plan_beginn === leg.partner_beginn && r.tour !== leg.tour) ?? null
      : null;
    const side = (r: UeRow | null, label: string, fallback: { beginn: string | null; tour: string | null }) => r
      ? { label, datum: r.datum, zeit: `${t(r.plan_beginn)}–${t(r.plan_ende)}`, weg: `${r.start} → ${r.ziel}`, tour: r.tourennummer, sk: r.tour, note: '' }
      : { label, datum: fallback.beginn ?? '', zeit: t(fallback.beginn), weg: 'nicht in diesem Monat oder keine Übernachtungstour', tour: fallback.tour, sk: null,
          note: ' (aus den Partner-Angaben)' };
    const isHin = leg.rolle === 'Hinweg';
    const fb = { beginn: leg.partner_beginn, tour: leg.partner_tourennummer };
    const sides = leg.rolle == null
      ? [side(leg, 'Übernachtungstour', fb)]
      : isHin ? [side(leg, 'Hinweg', fb), side(partner, 'Folgetour', fb)] : [side(partner, 'Hinweg', fb), side(leg, 'Folgetour', fb)];
    return { sides, partner, ort: leg.ort, folgetag: leg.am_folgetag > 0 };
  });

  protected readonly answer = computed(() => {
    const k = this.store.kanten.rows();
    if (!k.length) return '';
    const legs = k.reduce((s, r) => s + r.legs, 0);
    const paare = k.reduce((s, r) => s + r.paare, 0);
    const top = [...k].sort((a, b) => b.legs - a.legs)[0];
    const r = this.store.monthRow();
    return `${num(legs)} Übernachtungstouren (beide Wege), ${num(paare)} Paare; ${num(r?.besetzt ? (legs / r.besetzt) * 100 : null, 1)} % der besetzten Touren. `
      + `Häufigste Verbindung ${top.start} → ${top.ziel} (${num(top.legs)}).`;
  });

  protected readonly options = computed<EChartsCoreOption | null>(() => {
    const k = this.store.kanten.rows().filter((r) => r.start && r.ziel);
    if (!k.length) return null;
    const tk = this.theme.tokens();
    const c = ac13Colors(this.theme.tokens());
    const sel = this.store.edge();
    const deg = new Map<string, number>();
    for (const r of k) {
      deg.set(r.start!, (deg.get(r.start!) ?? 0) + r.legs);
      deg.set(r.ziel!, (deg.get(r.ziel!) ?? 0) + r.legs);
    }
    const maxDeg = Math.max(...deg.values());
    const maxLeg = Math.max(...k.map((r) => r.legs));
    const ranked = [...deg.entries()].sort((a, b) => b[1] - a[1]);
    const labelled = new Set(ranked.slice(0, 14).map(([s]) => s));
    return {
      aria: ariaDecal(),
      tooltip: { confine: true },
      animationDurationUpdate: 400,
      series: [{
        type: 'graph', layout: 'force', roam: true, draggable: true, cursor: 'pointer', left: 24, right: 60, top: 16, bottom: 16,
        force: { repulsion: 95, edgeLength: [26, 80], gravity: 0.22, friction: 0.3, layoutAnimation: true },
        edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 6,
        emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
        label: { show: true, position: 'right', fontSize: 10.5, color: tk.ink2,
          formatter: (p: { name: string }) => (labelled.has(p.name) ? p.name : '') },
        data: [...deg.entries()].map(([s, v]) => ({
          name: s, value: v, symbolSize: 6 + 18 * Math.sqrt(v / maxDeg),
          itemStyle: { color: sel && (sel.start === s || sel.ziel === s) ? c.ue : tk.ink2, borderColor: tk.surface, borderWidth: 1.5 },
        })),
        links: k.map((r) => {
          const on = sel && sel.start === r.start && sel.ziel === r.ziel;
          return {
            source: r.start, target: r.ziel, value: r.legs,
            lineStyle: { color: c.ue, width: 1 + 5 * (r.legs / maxLeg), opacity: sel ? (on ? 1 : 0.18) : 0.6, curveness: 0.18 },
          };
        }),
        tooltip: {
          formatter: (p: { dataType: string; data: { source?: string; target?: string; value: number; name?: string } }) => {
            if (p.dataType === 'edge') {
              const r = k.find((x) => x.start === p.data.source && x.ziel === p.data.target);
              return ttHead(`${p.data.source} → ${p.data.target}`) + ttRow(c.ue, 'Übernachtungstouren', num(r?.legs))
                + ttRow(null, 'davon Hinweg (Paare)', num(r?.paare)) + ttRow(null, 'Partner am Folgetag', num(r?.folgetag));
            }
            return ttHead(p.data.name ?? '') + ttRow(null, 'Touren an dieser Betriebsstelle (Start oder Ziel)', num(p.data.value));
          },
        },
      }],
    };
  });

  protected click(e: { dataType?: string; data?: { source?: string; target?: string } }): void {
    if (e?.dataType !== 'edge' || !e.data?.source || !e.data.target) return;
    const cur = this.store.edge();
    const same = cur && cur.start === e.data.source && cur.ziel === e.data.target;
    this.store.pickEdge(same ? null : { start: e.data.source, ziel: e.data.target });
  }
}
