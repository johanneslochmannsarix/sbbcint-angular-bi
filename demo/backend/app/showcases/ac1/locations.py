"""Coordinates for the AC-1 map: plan location names (Gold) joined BY NAME to Bronze
public_abstractcustomlocation latitude / longitude (string-typed, uncontracted on RT&S).

Gold keeps only the name (gold.py fact_person_tour_day: loc_in.name / loc_out.name), so the join is by name.

Columns: ONLY id, name, latitude, longitude (Johannes 2026-10-21). The table also carries street /
housenumber / postalcode / city; those are never selected, not even in probes - the core reader refuses
them before any I/O (core/bronze.py FORBIDDEN_COLUMNS, tests/core/test_bronze.py).
There is no documented type/category column, so "operational vs address-like" is decided on the NAME
alone (classify): a street/number or postcode pattern -> address_like; a station/yard word -> station;
neither -> unclassified. Address-like locations are WITHHELD (no coordinates, name not returned) until
Johannes decides; the browser lists them only as a count.

Status per name: ok | ambiguous (several Bronze rows with different coordinates) | absent (no Bronze row)
| no_coord (no parseable lat/lon) | withheld (address-like). Everything but ok is listed beside the map.
"""
from __future__ import annotations

import hashlib
import re

BRONZE_TABLE = "public_abstractcustomlocation"
BRONZE_COLUMNS = ["id", "name", "latitude", "longitude"]

# German / French / Italian street words followed by a house number, or a 4-5 digit postcode before a town
_ADDRESS_RE = re.compile(
    r"(?:stra(?:ss|ß)e|str\.|weg|gasse|allee|platz|ring|chemin|rue|route|via|avenue|ufer|damm)\s*\d{1,4}\s*[a-z]?\b"
    r"|\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöüé]+",
    re.IGNORECASE)
_STATION_RE = re.compile(
    r"bahnhof|\b(?:hbf|bf|gbf|rbf|pbf|rb)\b|rangier|güter|gleis|depot|werk|terminal|hafen|station|haltestelle"
    r"|abstell|betriebs|stellwerk|grenze|anschluss",
    re.IGNORECASE)


def classify(name: str | None) -> str:
    """address_like | station | unclassified, from the name only (no address column is ever read)."""
    if not name:
        return "unclassified"
    if _ADDRESS_RE.search(name):
        return "address_like"
    if _STATION_RE.search(name):
        return "station"
    return "unclassified"


def location_id(name: str) -> str:
    """Stable short id for a location name (the browser joins tours and coordinates by it)."""
    return "L-" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:10]


def coord(lat, lon) -> tuple[float, float] | None:
    try:
        a, o = float(str(lat).replace(",", ".")), float(str(lon).replace(",", "."))
    except (TypeError, ValueError):
        return None
    if not (-90 <= a <= 90 and -180 <= o <= 180) or (a == 0 and o == 0):
        return None
    return round(a, 6), round(o, 6)


def _filled(v) -> bool:
    return v is not None and str(v).strip() != ""


def join(referenced: list[dict], bronze_rows: list[dict], show_address_like: bool = False) -> list[dict]:
    """referenced: rows of location_names (location, rows). bronze_rows: BRONZE_COLUMNS of the table."""
    by_name: dict[str, list[dict]] = {}
    wanted = {r["location"] for r in referenced if _filled(r.get("location"))}
    for b in bronze_rows:
        if b.get("name") in wanted:
            by_name.setdefault(b["name"], []).append(b)
    out = []
    for r in sorted(referenced, key=lambda r: -(r.get("rows") or 0)):
        name = r.get("location")
        if not _filled(name):
            continue
        kind = classify(name)
        if kind == "address_like" and not show_address_like:
            out.append({"id": location_id(name), "name": None, "rows": r.get("rows"), "lat": None, "lon": None,
                        "kind": kind, "status": "withheld"})
            continue
        cands = by_name.get(name, [])
        entry = {"id": location_id(name), "name": name, "rows": r.get("rows"), "lat": None, "lon": None, "kind": kind}
        if not cands:
            entry["status"] = "absent"
        else:
            pts = {coord(c.get("latitude"), c.get("longitude")) for c in cands}
            if len(pts) == 1:
                xy = next(iter(pts))
                entry["status"] = "ok" if xy else "no_coord"
            else:
                xy, entry["status"] = None, "ambiguous"
            if xy:
                entry["lat"], entry["lon"] = xy
        out.append(entry)
    return out
