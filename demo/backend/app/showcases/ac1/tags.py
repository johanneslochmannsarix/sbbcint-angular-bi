"""Server-side parser for the ALP: / TN: / Prüfer: tags in fact_person_tour_day[kommentar] (AC-1).

The RT&S export has no structured trainer <-> trainee link (source gap, project-ac1-training-report); the
only pairing evidence is free text on the order item, e.g. "ALP: X\\nPrüfer: Y\\nTN: Z". It is shown as
«laut Freitext», never as a fact. Measured 2026-10-21 (PROD): 470 of 6 763 trainer rows carry a tag, and
of 37 TN names one resolves to exactly one trainee - most names are outside the model (external
participants) or ambiguous.

`tag_rows` is a QueryService transform over queries/ac1/day_tags.dax. It runs on UNMASKED rows inside the
backend and returns one row per tagged name; the name text goes out as label_freetext (masked to T-…) and a
resolved person as linked_sk (label_person key -> P-…). kommentar, person_name, firstname and lastname are
consumed here and never returned.
"""
from __future__ import annotations

import re

TAGS = {"ALP": "ALP", "TN": "TN", "PRÜFER": "PRUEFER", "PRUEFER": "PRUEFER"}
# a tag runs until the next tag or the end of the text
TAG_RE = re.compile(r"\b(ALP|TN|Prüfer|Pruefer)\s*:\s*(.*?)(?=\b(?:ALP|TN|Prüfer|Pruefer)\s*:|$)", re.S | re.I)
# several people inside one tag: ; / & "und" or a line break; "Name, Vorname" stays one person
SPLIT_RE = re.compile(r"\s*(?:;|/|&|\bund\b|\n)\s*", re.I)
# whom a tag usually names: trainees for TN, trainers for ALP / Prüfer (tried first, then everyone)
PREFERRED = {"TN": "auszubildende", "ALP": "ausbilder", "PRUEFER": "ausbilder"}


def tokens(s: str | None) -> frozenset[str]:
    return frozenset(t for t in re.findall(r"[a-zäöüéèàçß]+", (s or "").lower()) if len(t) > 1)


def parse(text: str | None) -> list[tuple[str, str]]:
    """kommentar -> [(tag, name), ...] in text order. Empty tags give (tag, "")."""
    out: list[tuple[str, str]] = []
    for m in TAG_RE.finditer(text or ""):
        tag = TAGS[m.group(1).upper()]
        names = [n.strip(" ,.:-\t") for n in SPLIT_RE.split(m.group(2).strip())]
        names = [n for n in names if n]
        if not names:
            out.append((tag, ""))
        out += [(tag, n) for n in names]
    return out


class Directory:
    """Name candidates of both audiences: person key -> token set, audience."""

    def __init__(self, people: list[dict]):
        self._people: list[tuple[str, str, frozenset[str]]] = []
        for p in people:
            key = p.get("person_sk")
            if key in (None, ""):
                continue
            toks = tokens(" ".join(str(p.get(c) or "") for c in ("person_name", "firstname", "lastname")))
            if toks:
                self._people.append((str(key), str(p.get("audience") or ""), toks))

    def _hits(self, toks: frozenset[str], audience: str | None) -> set[tuple[str, str]]:
        return {(k, a) for k, a, pt in self._people if toks <= pt and (audience is None or a == audience)}

    def resolve(self, tag: str, name: str) -> tuple[str, str | None, str | None]:
        """-> (match, person key, audience); match is one | several | none. Exactly one or nothing: an
        ambiguous name is never guessed."""
        toks = tokens(name)
        if not toks:
            return "none", None, None
        keys: set[str] = set()
        for aud in (PREFERRED.get(tag), None):
            hits = self._hits(toks, aud)
            keys = {k for k, _ in hits}
            if len(keys) == 1:
                k, a = sorted(hits)[0]
                auds = sorted({a2 for k2, a2 in hits if k2 == k})
                return "one", k, (aud or (auds[0] if len(auds) == 1 else "/".join(auds)))
            if keys:
                break                      # several in the preferred audience: do not widen the search
        return ("several" if keys else "none"), None, None


def _resolve_name(d: Directory, tag: str, name: str) -> list[tuple[str, str, str | None, str | None]]:
    """A name, or - when "A, B" does not resolve as one person - its comma parts, if any part resolves."""
    match, key, aud = d.resolve(tag, name)
    if match == "one" or "," not in name:
        return [(name, match, key, aud)]
    parts = [p.strip() for p in name.split(",") if p.strip()]
    resolved = [(p, *d.resolve(tag, p)) for p in parts]
    if any(m == "one" for _, m, _, _ in resolved):
        return resolved
    return [(name, match, key, aud)]


def tag_rows(rows: list[dict], params: dict) -> list[dict]:
    """QueryService transform for day_tags: (tagged rows + name candidates) -> one row per tag x name."""
    people = [r for r in rows if r.get("kind") == "person"]
    d = Directory(people)
    out: list[dict] = []
    for r in rows:
        if r.get("kind") != "tag":
            continue
        for i, (tag, name) in enumerate(parse(r.get("kommentar"))):
            for nm, match, key, aud in (_resolve_name(d, tag, name) if name else [("", "none", None, None)]):
                out.append({
                    "person_sk": r.get("person_sk"),
                    "tourbezeichnung": r.get("tourbezeichnung"),
                    "start_time": r.get("start_time"),
                    "tag": tag,
                    "tag_index": i,
                    "tag_name": nm or None,
                    "linked_sk": key,
                    "linked_audience": aud,
                    "match": match if nm else "empty",
                })
    return out
