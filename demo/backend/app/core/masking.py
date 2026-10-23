"""The ONE masking layer. Every named-query response passes through `Masker.mask_rows` before it is cached
or leaves the backend (service.py); no showcase masks on its own.

Column roles (declared per query in <name>.roles.json, every returned column needs one):
    id, code, measure, date                      passed through
    label_org, label_qualification, label_location passed through (org units, qualification and place names
                                                   are not person data, PLAN §11.4)
    label_technical                              passed through: names of technical objects (pipeline steps,
                                                   tables / entities, notebook activities, Spark stages, regime
                                                   notes the collector generates); /metrics, option B
    label_person    names / personnel numbers / person keys -> pseudonym P-<hex>
    label_freetext  free text that may contain names (beschreibung, kommentar, dor_creator, PLAN §12.3)
                    -> token T-<hex>

Pseudonyms: HMAC-SHA256 with a random per-process key over (tenant, person key). Same person key in the
same tenant -> same pseudonym in every showcase of one process (AC-1 / AC-2 / AC-8 cross-links, D2); a
restart or another process (each dev instance is one) gives everyone new pseudonyms. pseudonym -> person
key is kept in memory for server-side filter resolution and is never serialised.

Masked is the default. Real labels only when the process was started with DEMO_REAL=1 (run.ps1 -Real):
then label_person / label_freetext pass through, except the person-key column itself, which stays the
pseudonym in every mode (it is the handle the UI filters and cross-links by). Blank labels stay null in
both modes, so "no name in the source" stays visible (QDASH-8) instead of getting a fake label.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from dataclasses import dataclass

ROLES = ("id", "code", "label_person", "label_freetext", "label_org", "label_qualification", "label_location",
         "label_technical", "measure", "date")
MASKED_ROLES = frozenset({"label_person", "label_freetext"})
REAL_ENV_VAR = "DEMO_REAL"

# Person columns (docs/schemas: public_worker firstname, lastname, name, personnelnumber are pii=true; the
# SK/NK identify a person). Declared under these names they must be label_person. Extend, never shrink.
PERSON_COLUMNS = frozenset({"person_sk", "person_nk", "person_name", "firstname", "lastname", "personnelnumber",
                            "person_id", "worker_name"})
# Free-text columns that may contain names (PLAN §12.3). Declared under these names they must be label_freetext.
FREETEXT_COLUMNS = frozenset({"beschreibung", "kommentar", "dor_creator", "doi_comment", "dor_comment", "comment",
                              "description"})

PSEUDONYM_RE = re.compile(r"^P-[0-9a-f]{6,16}$")
TEXT_TOKEN_RE = re.compile(r"^T-[0-9a-f]{6,16}$")


def _blank(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def real_from_env() -> bool:
    return os.environ.get(REAL_ENV_VAR) == "1"


@dataclass(frozen=True)
class PersonRef:
    tenant: str
    key: str


class Masker:
    def __init__(self, real: bool | None = None, key: bytes | None = None):
        self.real = real_from_env() if real is None else real
        self._key = key or secrets.token_bytes(32)
        self._by_person: dict[tuple[str, str], str] = {}     # (tenant, person key) -> pseudonym
        self._by_pseudonym: dict[str, PersonRef] = {}        # pseudonym -> (tenant, person key)
        self._by_text: dict[str, str] = {}                   # text -> token
        self._tokens: set[str] = set()

    @property
    def mode(self) -> str:
        return "real" if self.real else "masked"

    def _digest(self, *parts: str) -> str:
        msg = "\x1f".join(parts).encode("utf-8")
        return hmac.new(self._key, msg, hashlib.sha256).hexdigest()

    def pseudonym(self, person_key, tenant: str) -> str:
        k = (str(tenant), str(person_key))
        if k in self._by_person:
            return self._by_person[k]
        digest = self._digest("person", *k)
        n = 6
        while f"P-{digest[:n]}" in self._by_pseudonym:       # collision with another person
            n += 2
        p = f"P-{digest[:n]}"
        self._by_person[k] = p
        self._by_pseudonym[p] = PersonRef(*k)
        return p

    def resolve(self, pseudonym: str, tenant: str | None = None) -> PersonRef | None:
        """pseudonym -> person; None if unknown, or if it belongs to another tenant than `tenant`."""
        ref = self._by_pseudonym.get(pseudonym)
        if ref is None or (tenant is not None and ref.tenant != tenant):
            return None
        return ref

    def text_token(self, text: str) -> str:
        if text in self._by_text:
            return self._by_text[text]
        digest = self._digest("text", text)
        n = 6
        while f"T-{digest[:n]}" in self._tokens:
            n += 2
        t = f"T-{digest[:n]}"
        self._by_text[text] = t
        self._tokens.add(t)
        return t

    def __len__(self) -> int:
        return len(self._by_person)

    def mask_rows(self, rows: list[dict], roles: dict[str, str], tenant: str | None,
                  person_keys: tuple[str, ...] = (), label_of: dict[str, str] | None = None) -> list[dict]:
        """Mask in place of a copy. person_keys = label_person columns holding a person key (replaced by the
        pseudonym in every mode); label_of = other label_person column -> the key column it belongs to."""
        label_of = label_of or {}
        persons = [c for c, r in roles.items() if r == "label_person"]
        texts = [c for c, r in roles.items() if r == "label_freetext"]
        if not persons and not texts:
            return rows
        if persons and tenant is None:
            raise ValueError("label_person columns on a dataset without a tenant")
        for c in persons:
            if c not in person_keys and label_of.get(c) not in person_keys:
                raise ValueError(f"label_person column {c} is neither a person key nor tied to one")
        out = []
        for row in rows:
            new = dict(row)
            pseudo: dict[str, str | None] = {}
            for k in person_keys:
                if k in row:
                    kv = row.get(k)
                    pseudo[k] = None if _blank(kv) else self.pseudonym(kv, tenant)
                    new[k] = pseudo[k]
            for c in persons:
                if c in person_keys or c not in row:
                    continue
                v = row.get(c)
                if _blank(v):
                    new[c] = None
                elif not self.real:
                    p = pseudo.get(label_of[c])
                    new[c] = p if p is not None else "P-unknown"
            for c in texts:
                if c not in row:
                    continue
                v = row.get(c)
                if _blank(v):
                    new[c] = None
                elif not self.real:
                    new[c] = self.text_token(str(v))
            out.append(new)
        return out
