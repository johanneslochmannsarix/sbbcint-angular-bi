/**
 * The billing rules every card cites as a footnote (an invoice's small print): Marcel Ludwig's answers of
 * 08.10.2026 (docs/handovers/ANSWERS-ac9-marcel-20261008.de.md) and Johannes' rulings. The footer lists them in
 * this order; a card names its rule by number. Order names are never quoted here (they are masked data).
 */
export interface Rule {
  n: number;
  key: string;
  text: string;
}

export const RULES: readonly Rule[] = [
  { n: 1, key: 'ist', text: 'Abrechnungsbasis ist IST. Planzeiten sind Kontext und nie eine abgerechnete Zahl.' },
  { n: 2, key: 'netto', text: 'AZU und Fahrten werden abgerechnet; abrechenbar ist «ohne Pause» = brutto − Pause.' },
  { n: 3, key: 'einarbeitung', text: 'Einarbeitung (Ausbildung DL, 30-Std.-Übergang DL) wird nie verrechnet und ist nicht im Modell; zwei Kundenaufträge 2026 ohne Kürzel zählen als AÜ.' },
  { n: 4, key: 'kategorie', text: 'National / International bestimmt der Auftrag (SBB-CD-Dienstleistung); die Tournummer ist nur Gegenprobe. Ein NL-Kennzeichen gibt es nicht.' },
  { n: 5, key: 'schwelle', text: 'Schwellwerte gelten je Schicht, nicht je Kunde: 12 h und 14 h, ab 2027 zusätzlich 10 h (IST-Dauer brutto der Tour).' },
  { n: 6, key: 'mindest', text: 'Mindestabnahme ist je Kunde und je Mitarbeiter/in vereinbart: nicht modelliert, bleibt in der Excel von Finance.' },
  { n: 7, key: 'quote', text: 'Rückmeldequote zählt Touren, nicht Tourelemente; Achse ist der Planmonat (je Abrechnungsmonat wäre sie immer 100 %).' },
  { n: 8, key: 'monat', text: 'Abrechnungsmonat = Monat des IST-Beginns der ganzen Tour; der Auftragsname ist der Schlüssel für Kunde und Preis.' },
];

export function rule(key: string): Rule {
  return RULES.find((r) => r.key === key)!;
}
