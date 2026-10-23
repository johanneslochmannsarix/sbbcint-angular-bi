"""Forbidden columns: a static check over every .dax under queries/. The backend refuses to start on a
violation (main.create_app) and tests/core/test_forbidden.py fails on one.

ONE home for the lists: extend GLOBAL / PER_SHOWCASE (D2 adds here), never copy them into a showcase.

- everywhere: absence reasons (PLAN §13.3: dim_absence_type / absence_name are D3-adjacent; absences are
  windows only, not even in -Real; absence_type_sk is the key to the reason, so it is out too) and date
  of birth (AC-7 ruling, PLAN §11.4)
- queries/ac1/**: IST / executed times (PLAN §12.3, HARD RULE project-ausbilder-plantafel-plan-only: the
  Plantafel shows plan times only). Names from docs/schemas/rts.schema.json (executed*, ist_start/ende/
  beginn/dauer*/stunden*, actualdistance ...); the RT&S import model itself carries none today
- queries/ac2/**: AC-2 minimisation (no column the AC-2 reports do not show: dim_person firstname /
  lastname / personnelnumber / person_nk), carried over from the AC-2 backend

Matching is case-insensitive on the whole file, comments included: a forbidden name in a comment fails too.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Rule:
    reason: str
    pattern: re.Pattern


def _r(reason: str, pattern: str) -> Rule:
    return Rule(reason, re.compile(pattern, re.IGNORECASE))


GLOBAL: tuple[Rule, ...] = (
    _r("absence reason (PLAN §13.3)", r"dim_absence_type|absence_name|absence_type_(sk|name)"),
    _r("date of birth (AC-7 ruling)", r"birth|geburt|dateofbirth"),
)
PER_SHOWCASE: dict[str, tuple[Rule, ...]] = {
    "ac1": (
        _r("IST / executed time (plan-only HARD RULE, PLAN §12.3)",
           r"executed[a-z_]*|\bist_(start|ende|beginn|dauer|stunden)[a-z_]*"
           r"|\bactual_?(start|end|begin|time|distance|duration)[a-z_]*"),
    ),
    "ac2": (
        _r("AC-2 minimisation: column the AC-2 reports do not show",
           r"'?dim_person'?\s*\[\s*(firstname|lastname|personnelnumber|person_nk)\s*\]"),
    ),
}


@dataclass(frozen=True)
class Violation:
    path: str
    reason: str
    match: str

    def __str__(self) -> str:
        return f"{self.path}: {self.reason} ({self.match!r})"


def rules_for(showcase: str) -> tuple[Rule, ...]:
    return GLOBAL + PER_SHOWCASE.get(showcase, ())


def check_text(showcase: str, text: str, path: str = "<text>") -> list[Violation]:
    out = []
    for rule in rules_for(showcase):
        for m in rule.pattern.finditer(text):
            out.append(Violation(path, rule.reason, m.group(0)))
    return out


def check_tree(queries_dir: Path) -> list[Violation]:
    """Every .dax below queries_dir; the showcase is the first folder under it (queries/<ac>/...)."""
    out: list[Violation] = []
    for p in sorted(queries_dir.rglob("*.dax")):
        rel = p.relative_to(queries_dir)
        showcase = rel.parts[0] if len(rel.parts) > 1 else ""
        out += check_text(showcase, p.read_text(encoding="utf-8"), rel.as_posix())
    return out


class ForbiddenColumnError(RuntimeError):
    pass


def enforce(queries_dir: Path) -> None:
    v = check_tree(queries_dir)
    if v:
        raise ForbiddenColumnError("forbidden column(s) in named queries:\n  " + "\n  ".join(map(str, v)))
