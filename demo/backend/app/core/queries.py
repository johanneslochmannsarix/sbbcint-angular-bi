"""Named queries: queries/<showcase>/[<sub>/]<name>.dax + <name>.roles.json. The browser never sends DAX.

Query id = path below queries/<showcase>/ without the extension ("persons", "cc/persons"). A request for
`name` with tenant=T first looks for <name>, then for the tenant variant <cc|rts>/<name> (AC-2 keeps one
file per tenant because CC and RT&S have their own logic).

<name>.roles.json (strict: unknown keys are refused):

    {
      "model": "import" | "leitstelle_olten" | "platform_metrics" | "fico" | "offene_schichten",   datasets.py
      "tenant": "RTS" | "CARGOCONTROL" | "param",   import / olten only; "param" = request param picks it
      "replaces": "...", "view": "...", "grain": "...",                  required, documentation
      "params": { "<name>": { "type": ..., "required": false, ... } }, request whitelist, see below
      "columns": { "<normalised column>": "<role>" | {"role": "label_person", "person": "<key column>"} },
      "person_key": "<column>" | ["<column>", ...],   label_person column(s) holding the person key
      "derived": { "<column>": "<role>" },           columns a server-side transform adds (service.run)
      "person_aggregate": true                      the query reads person tables only in aggregates
    }

env (PROD|QA) and tenant (when "param") select the dataset; they never reach the DAX text, so they are not
declared under "params" (except on platform_metrics, which has one dataset and may filter by them).

Param types -> placeholders (a param with "filter_column" renders {{<name>_filter}} as
TREATAS ( { <literal> }, <column> ), or ALL ( <column> ) when absent - like an empty report slicer;
without it {{<name>}} is the literal, or BLANK () when absent):
    pseudonym    P-xxxxxx, resolved server side to the person key of the request's tenant
    sk           [0-9A-Za-z_-]{8,128}
    uuid         ^[0-9a-f-]{36}$ (lower case; /metrics chain_id, the original metrics backend's rule)
    enum         "values": [...]; the literal comes from the list, never from the request string
    int          "min" / "max"
    date         YYYY-MM-DD -> DATE ( y, m, d ); "default": "today" | "today+N" | "today-N"
    month        YYYY-MM -> DATE ( y, m, 1 ); "default": "this_month"
    date_window  name must be "dates": request keys date_from / date_to -> {{date_from}} {{date_to}};
                 "default_days": N, "anchor": "from_today" (today .. today+N) | "to_today" (today-N ..
                 today), "max_days" (default 400)
"""
from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import datasets as D
from .masking import FREETEXT_COLUMNS, PERSON_COLUMNS, PSEUDONYM_RE, ROLES, Masker

QUERIES_DIR = Path(__file__).resolve().parent.parent.parent / "queries"
SHOWCASES = ("ac1", "ac2", "ac8", "metrics", "ac4", "ac10", "ac6", "ac7", "ac9", "ac13")
TENANT_DIR = {"CARGOCONTROL": "cc", "RTS": "rts"}
MAX_WINDOW_DAYS = 400
SELECTORS = ("tenant", "env")

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_SK_RE = re.compile(r"^[0-9A-Za-z_\-]{8,128}$")
_UUID_RE = re.compile(r"^[0-9a-f-]{36}$")
_KEY_RE = re.compile(r"^[0-9A-Za-z_\-.:]{1,128}$")            # a resolved person key at render time
_COLREF_RE = re.compile(r"^'?[A-Za-z_][A-Za-z0-9_ ]*'?\[[A-Za-z_][A-Za-z0-9_ ]*\]$")
_ENUM_RE = re.compile(r"^[A-Za-z0-9_\-. ]{1,64}$")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_DEFAULT_DATE_RE = re.compile(r"^today(?:([+-])(\d{1,4}))?$")
_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}")

_TOP_KEYS = {"model", "tenant", "replaces", "view", "grain", "params", "columns", "person_key", "derived",
             "person_aggregate", "note"}
_REQUIRED_TOP = ("model", "replaces", "view", "grain", "columns")
_PARAM_KEYS = {
    "pseudonym": {"required", "filter_column"},
    "sk": {"required", "filter_column"},
    "uuid": {"required", "filter_column"},
    "enum": {"required", "filter_column", "values"},
    "int": {"required", "min", "max"},
    "date": {"required", "default"},
    "month": {"required", "default"},
    "date_window": {"default_days", "anchor", "max_days"},
}


class ParamError(ValueError):
    """Request parameters failed validation -> HTTP 400."""


class QueryDefinitionError(ValueError):
    """A query definition breaks the role / minimisation contract -> the backend refuses to start."""


@dataclass(frozen=True)
class Param:
    name: str
    type: str
    required: bool = False
    filter_column: str | None = None
    values: tuple[str, ...] = ()
    min: int | None = None
    max: int | None = None
    default: str | None = None
    default_days: int = 30
    anchor: str = "to_today"
    max_days: int = MAX_WINDOW_DAYS

    @property
    def request_keys(self) -> tuple[str, ...]:
        return ("date_from", "date_to") if self.type == "date_window" else (self.name,)

    @property
    def placeholders(self) -> set[str]:
        if self.type == "date_window":
            return {"date_from", "date_to"}
        return {f"{self.name}_filter"} if self.filter_column else {self.name}

    def describe(self) -> list[dict]:
        out = []
        for k in self.request_keys:
            e: dict = {"name": k, "type": self.type, "required": self.required}
            if self.values:
                e["allowed"] = list(self.values)
            if self.type == "date_window":
                e["default_days"] = self.default_days
                e["anchor"] = self.anchor
            elif self.default:
                e["default"] = self.default
            out.append(e)
        return out


@dataclass(frozen=True)
class NamedQuery:
    showcase: str
    qid: str                                  # "persons" / "cc/persons"
    body: str
    model: str
    tenant: str | None                        # fixed tenant, "param", or None (platform_metrics)
    params: dict[str, Param]
    columns: dict[str, str]                   # normalised column -> role (what the DAX returns)
    derived: dict[str, str]                   # columns added by a server-side transform
    person_keys: tuple[str, ...]
    label_of: dict[str, str]                  # label_person column -> its key column
    meta: dict[str, str] = field(default_factory=dict)

    @property
    def name(self) -> str:
        return self.qid.rsplit("/", 1)[-1]

    @property
    def roles(self) -> dict[str, str]:
        return {**self.columns, **self.derived}

    @property
    def selectors(self) -> tuple[str, ...]:
        if self.model not in D.SELECTED_BY_TENANT_ENV:
            return ()
        return ("tenant", "env") if self.tenant == "param" else ("env",)

    @property
    def accepted_keys(self) -> set[str]:
        keys = {k for p in self.params.values() for k in p.request_keys}
        return keys | set(self.selectors)

    def describe(self) -> dict:
        params: list[dict] = []
        if "tenant" in self.selectors:
            params.append({"name": "tenant", "required": True, "allowed": list(D.tenants_for(self.model))})
        if "env" in self.selectors:
            params.append({"name": "env", "required": True, "allowed": list(D.ENVS)})
        for p in sorted(self.params.values(), key=lambda p: p.name):
            params += p.describe()
        return {"showcase": self.showcase, "id": self.qid, "name": self.name, "model": self.model,
                "tenant": self.tenant, "params": params, "columns": self.roles,
                "person_keys": list(self.person_keys), **self.meta}


# --------------------------------------------------------------------------- loading

def _fail(where: str, msg: str) -> QueryDefinitionError:
    return QueryDefinitionError(f"{where}: {msg}")


def _parse_param(where: str, name: str, spec, allow_selector_name: bool = False) -> Param:
    if not isinstance(spec, dict) or "type" not in spec:
        raise _fail(where, f"param {name}: needs an object with a type")
    ptype = spec["type"]
    if ptype not in _PARAM_KEYS:
        raise _fail(where, f"param {name}: unknown type {ptype!r}")
    extra = set(spec) - _PARAM_KEYS[ptype] - {"type"}
    if extra:
        raise _fail(where, f"param {name}: unknown key(s) {sorted(extra)} for type {ptype}")
    if ptype == "date_window":
        if name != "dates":
            raise _fail(where, "a date_window param must be named dates")
        anchor = spec.get("anchor", "to_today")
        if anchor not in ("from_today", "to_today"):
            raise _fail(where, "dates.anchor must be from_today or to_today")
        days, max_days = spec.get("default_days", 30), spec.get("max_days", MAX_WINDOW_DAYS)
        if not (isinstance(days, int) and isinstance(max_days, int) and 0 <= days <= max_days <= MAX_WINDOW_DAYS):
            raise _fail(where, f"dates: need 0 <= default_days <= max_days <= {MAX_WINDOW_DAYS}")
        return Param(name, ptype, default_days=days, anchor=anchor, max_days=max_days)
    reserved = ("fresh", "date_from", "date_to") + (() if allow_selector_name else SELECTORS)
    if not _NAME_RE.match(name) or name in reserved:
        raise _fail(where, f"bad or reserved param name {name!r}")
    fc = spec.get("filter_column")
    if fc is not None and not (isinstance(fc, str) and _COLREF_RE.match(fc)):
        raise _fail(where, f"param {name}: filter_column must look like 'table'[column]")
    values: tuple[str, ...] = ()
    if ptype == "enum":
        values = tuple(spec.get("values") or ())
        if not values or not all(isinstance(v, str) and _ENUM_RE.match(v) for v in values):
            raise _fail(where, f"param {name}: enum values must be simple strings")
    lo, hi = spec.get("min"), spec.get("max")
    if ptype == "int" and not (isinstance(lo, int) and isinstance(hi, int) and lo <= hi):
        raise _fail(where, f"param {name}: int needs min <= max")
    default = spec.get("default")
    if default is not None:
        ok = (ptype == "date" and _DEFAULT_DATE_RE.match(str(default))) or (ptype == "month" and default == "this_month")
        if not ok:
            raise _fail(where, f"param {name}: bad default {default!r}")
    required = spec.get("required", False)
    if not isinstance(required, bool):
        raise _fail(where, f"param {name}: required must be true/false")
    return Param(name, ptype, required, fc, values, lo, hi, default)


def _parse(showcase: str, dax_path: Path, base: Path) -> NamedQuery:
    qid = dax_path.relative_to(base).with_suffix("").as_posix()
    where = f"{showcase}/{qid}"
    if not all(_NAME_RE.match(part) for part in qid.split("/")) or qid.count("/") > 1:
        raise _fail(where, "bad query file name (lower snake case, at most one sub folder)")
    roles_path = dax_path.with_suffix(".roles.json")
    if not roles_path.exists():
        raise _fail(where, f"missing {roles_path.name}: every query declares its column roles")
    try:
        spec = json.loads(roles_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise _fail(where, f"{roles_path.name} is not JSON: {e}") from None
    if not isinstance(spec, dict):
        raise _fail(where, "roles.json must be an object")
    unknown = set(spec) - _TOP_KEYS
    if unknown:
        raise _fail(where, f"unknown key(s) in roles.json: {sorted(unknown)}")
    for k in _REQUIRED_TOP:
        if not spec.get(k):
            raise _fail(where, f"roles.json needs {k!r}")

    # body: leading comment lines are documentation, the rest is the query
    lines = dax_path.read_text(encoding="utf-8").splitlines()
    while lines and (lines[0].lstrip().startswith("--") or lines[0].lstrip().startswith("//") or not lines[0].strip()):
        lines.pop(0)
    body = "\n".join(lines).strip() + "\n"
    if not body.lstrip().upper().startswith(("EVALUATE", "DEFINE")):
        raise _fail(where, "body must start with EVALUATE or DEFINE")

    model = spec["model"]
    if model not in D.MODELS:
        raise _fail(where, f"unknown model {model!r}")
    tenant = spec.get("tenant")
    if model in D.SELECTED_BY_TENANT_ENV:
        allowed = D.tenants_for(model)
        if tenant != "param" and tenant not in allowed:
            raise _fail(where, f"model {model} needs tenant one of {list(allowed)} or 'param'")
    elif tenant is not None:
        raise _fail(where, f"model {model} has one dataset: no tenant")
    sub = qid.split("/")[0] if "/" in qid else None
    if sub in TENANT_DIR.values() and tenant != {v: k for k, v in TENANT_DIR.items()}[sub]:
        raise _fail(where, f"a query under {sub}/ must declare that tenant")

    params: dict[str, Param] = {}
    for pname, pspec in (spec.get("params") or {}).items():
        # env / tenant select the dataset, except on platform_metrics (one dataset), where they are filters
        params[pname] = _parse_param(where, pname, pspec, allow_selector_name=model not in D.SELECTED_BY_TENANT_ENV)

    def parse_cols(obj, what: str) -> tuple[dict[str, str], dict[str, str]]:
        cols: dict[str, str] = {}
        ties: dict[str, str] = {}
        if not isinstance(obj, dict):
            raise _fail(where, f"{what} must be an object")
        for col, r in obj.items():
            if not _NAME_RE.match(col):
                raise _fail(where, f"{what}: bad column name {col!r}")
            if isinstance(r, dict):
                if set(r) - {"role", "person"}:
                    raise _fail(where, f"{what}.{col}: only role / person allowed")
                role, tie = r.get("role"), r.get("person")
            else:
                role, tie = r, None
            if role not in ROLES:
                raise _fail(where, f"column {col}: unknown role {role!r}")
            if col in PERSON_COLUMNS and role != "label_person":
                raise _fail(where, f"{col} is person data, role must be label_person")
            if col in FREETEXT_COLUMNS and role not in ("label_freetext", "label_person"):
                raise _fail(where, f"{col} is free text that may contain names, role must be label_freetext")
            if tie is not None:
                if role != "label_person":
                    raise _fail(where, f"column {col}: only a label_person column can name its person")
                ties[col] = tie
            cols[col] = role
        return cols, ties

    columns, ties = parse_cols(spec["columns"], "columns")
    derived, dties = parse_cols(spec.get("derived") or {}, "derived")
    if set(columns) & set(derived):
        raise _fail(where, "a column is both returned and derived")
    roles = {**columns, **derived}
    ties.update(dties)

    pk = spec.get("person_key")
    person_keys = tuple([pk] if isinstance(pk, str) else (pk or []))
    for k in person_keys:
        if roles.get(k) != "label_person":
            raise _fail(where, f"person_key {k} must be a declared label_person column")
    label_of: dict[str, str] = {}
    for col, role in roles.items():
        if role != "label_person" or col in person_keys:
            continue
        tie = ties.get(col)
        if tie is None:
            if len(person_keys) != 1:
                raise _fail(where, f"label_person column {col} needs a person_key (one key, or name it with 'person')")
            tie = person_keys[0]
        if tie not in person_keys:
            raise _fail(where, f"column {col} names {tie!r}, which is not a person_key")
        label_of[col] = tie
    if any(r == "label_person" for r in roles.values()) and not person_keys:
        raise _fail(where, "label_person columns need a person_key")
    if model == "platform_metrics" and person_keys:
        raise _fail(where, "platform_metrics carries no person data")
    has_person_param = any(p.type == "pseudonym" for p in params.values())
    if ("dim_person" in body or "person_sk" in body) and not person_keys and not has_person_param \
            and not spec.get("person_aggregate"):
        raise _fail(where, "reads person data without a declared person key "
                    "(declare person_key, or person_aggregate: true for counts only)")

    for col in columns:                      # every returned column must be produced by name in the body
        if f'"{col}"' not in body and f"[{col}]" not in body:
            raise _fail(where, f"declared column {col} not produced by the body")

    used = set(_PLACEHOLDER_RE.findall(body))
    provided: set[str] = set()
    for p in params.values():
        provided |= p.placeholders
    if used != provided:
        raise _fail(where, f"placeholders {sorted(used)} != declared {sorted(provided)}")
    stripped = _PLACEHOLDER_RE.sub("", body)
    if "{{" in stripped or "}}" in stripped:
        raise _fail(where, "malformed placeholder")

    meta = {k: str(spec[k]) for k in ("replaces", "view", "grain", "note") if spec.get(k)}
    return NamedQuery(showcase, qid, body, model, tenant, params, columns, derived, person_keys, label_of, meta)


Registry = dict[str, dict[str, NamedQuery]]          # showcase -> query id -> query


def load_queries(directory: Path = QUERIES_DIR, showcases: tuple[str, ...] = SHOWCASES) -> Registry:
    reg: Registry = {}
    for sc in showcases:
        base = directory / sc
        reg[sc] = {}
        if not base.exists():
            continue
        for p in sorted(base.rglob("*.dax")):
            q = _parse(sc, p, base)
            reg[sc][q.qid] = q
        for p in sorted(base.rglob("*.roles.json")):
            if not p.with_name(p.name[: -len(".roles.json")] + ".dax").exists():
                raise QueryDefinitionError(f"{sc}/{p.relative_to(base).as_posix()}: roles.json without a .dax")
    return reg


def lookup(reg: Registry, showcase: str, name: str, tenant: str | None) -> NamedQuery | None:
    qs = reg.get(showcase, {})
    if name in qs:
        return qs[name]
    if tenant in TENANT_DIR and "/" not in name:
        return qs.get(f"{TENANT_DIR[tenant]}/{name}")
    return None


# --------------------------------------------------------------------------- request validation

@dataclass(frozen=True)
class Selection:
    tenant: str | None
    env: str | None


def select(q: NamedQuery, raw: dict[str, str]) -> Selection:
    """Pop and validate the dataset selectors (tenant / env) from raw. Exact match against the whitelist."""
    if q.model not in D.SELECTED_BY_TENANT_ENV:
        return Selection(None, None)
    env = raw.pop("env", None)
    if env not in D.ENVS:
        raise ParamError(f"env must be one of {', '.join(D.ENVS)}")
    env = D.ENVS[D.ENVS.index(env)]
    t = raw.pop("tenant", None)
    allowed = D.tenants_for(q.model)
    if q.tenant == "param":
        if t not in allowed:
            raise ParamError(f"tenant must be one of {', '.join(allowed)}")
        tenant = allowed[allowed.index(t)]
    else:
        if t is not None and t != q.tenant:
            raise ParamError(f"{q.showcase}/{q.qid} is defined for {q.tenant} only")
        tenant = q.tenant
    return Selection(tenant, env)


def _parse_date(key: str, raw: str) -> dt.date:
    if not _ISO_DATE_RE.match(raw):
        raise ParamError(f"{key} must be an ISO date YYYY-MM-DD")
    try:
        return dt.date.fromisoformat(raw)
    except ValueError as e:
        raise ParamError(f"{key} is not a valid date") from e


def _default_date(spec: str, today: dt.date) -> dt.date:
    m = _DEFAULT_DATE_RE.match(spec)
    assert m
    n = int(m.group(2) or 0)
    return today + dt.timedelta(days=-n if m.group(1) == "-" else n)


def validate(q: NamedQuery, raw: dict[str, str], sel: Selection, masker: Masker,
             today: dt.date | None = None) -> dict[str, object]:
    """Whitelist check of the non-selector params. Returns canonical typed params (also the cache key; a
    person stays a pseudonym there). Raises ParamError."""
    today = today or dt.date.today()
    unknown = set(raw) - {k for p in q.params.values() for k in p.request_keys}     # selectors popped by select()
    if unknown:
        raise ParamError(f"unknown parameter(s) for {q.showcase}/{q.qid}: {', '.join(sorted(unknown))}")
    out: dict[str, object] = {}
    for p in q.params.values():
        if p.type == "date_window":
            if p.anchor == "from_today":
                d_from = _parse_date("date_from", raw["date_from"]) if "date_from" in raw else today
                d_to = (_parse_date("date_to", raw["date_to"]) if "date_to" in raw
                        else d_from + dt.timedelta(days=p.default_days))
            else:
                d_to = _parse_date("date_to", raw["date_to"]) if "date_to" in raw else today
                d_from = (_parse_date("date_from", raw["date_from"]) if "date_from" in raw
                          else d_to - dt.timedelta(days=p.default_days))
            if d_from > d_to:
                raise ParamError("date_from must not be after date_to")
            if (d_to - d_from).days > p.max_days:
                raise ParamError(f"date window larger than {p.max_days} days")
            out["date_from"], out["date_to"] = d_from, d_to
            continue
        val = raw.get(p.name)
        if val is None:
            if p.required:
                raise ParamError(f"{p.name} is required for {q.qid}")
            if p.type == "date" and p.default:
                out[p.name] = _default_date(p.default, today)
            elif p.type == "month" and p.default:
                out[p.name] = dt.date(today.year, today.month, 1)
            continue
        if p.type == "pseudonym":
            if not PSEUDONYM_RE.match(val):
                raise ParamError(f"{p.name} must be a pseudonym P-xxxxxx")
            if masker.resolve(val, sel.tenant) is None:
                raise ParamError(f"{p.name}: unknown pseudonym for this tenant "
                                 "(pseudonyms change when the backend restarts)")
            out[p.name] = val
        elif p.type == "sk":
            if not _SK_RE.match(val):
                raise ParamError(f"{p.name} must match {_SK_RE.pattern}")
            out[p.name] = val
        elif p.type == "uuid":
            if not _UUID_RE.match(val):
                raise ParamError(f"{p.name} must match {_UUID_RE.pattern}")
            out[p.name] = val
        elif p.type == "enum":
            if val not in p.values:
                raise ParamError(f"{p.name} must be one of {', '.join(p.values)}")
            out[p.name] = p.values[p.values.index(val)]
        elif p.type == "int":
            if not re.fullmatch(r"-?\d{1,9}", val):
                raise ParamError(f"{p.name} must be an integer")
            n = int(val)
            if not p.min <= n <= p.max:
                raise ParamError(f"{p.name} must be between {p.min} and {p.max}")
            out[p.name] = n
        elif p.type == "date":
            out[p.name] = _parse_date(p.name, val)
        elif p.type == "month":
            if not _MONTH_RE.match(val):
                raise ParamError(f"{p.name} must be YYYY-MM")
            y, m = int(val[:4]), int(val[5:])
            if not 1 <= m <= 12:
                raise ParamError(f"{p.name} is not a valid month")
            out[p.name] = dt.date(y, m, 1)
    return out


# --------------------------------------------------------------------------- render

def _string_literal(value: str, pattern: re.Pattern) -> str:
    if not pattern.match(value):              # defence in depth: render never trusts its caller
        raise ParamError("a value failed validation at render time")
    return f'"{value}"'


def render(q: NamedQuery, params: dict[str, object], sel: Selection, masker: Masker) -> str:
    """Substitute validated params. Every substituted string is built from constants, parsed ints or
    regex-checked ids; a pseudonym is resolved to its person key here and nowhere else."""
    subs: dict[str, str] = {}
    for p in q.params.values():
        if p.type == "date_window":
            for k in ("date_from", "date_to"):
                d = params[k]
                assert isinstance(d, dt.date)
                subs[k] = f"DATE ( {int(d.year)}, {int(d.month)}, {int(d.day)} )"
            continue
        val = params.get(p.name)
        lit: str | None
        if val is None:
            lit = None
        elif p.type == "pseudonym":
            ref = masker.resolve(str(val), sel.tenant)
            if ref is None:
                raise ParamError(f"{p.name}: unknown pseudonym")
            lit = _string_literal(ref.key, _KEY_RE)
        elif p.type == "sk":
            lit = _string_literal(str(val), _SK_RE)
        elif p.type == "uuid":
            lit = _string_literal(str(val), _UUID_RE)
        elif p.type == "enum":
            lit = _string_literal(p.values[p.values.index(str(val))], _ENUM_RE)
        elif p.type == "int":
            lit = str(int(val))  # type: ignore[arg-type]
        else:                                  # date / month
            assert isinstance(val, dt.date)
            lit = f"DATE ( {int(val.year)}, {int(val.month)}, {int(val.day)} )"
        if p.filter_column:
            subs[f"{p.name}_filter"] = (f"ALL ( {p.filter_column} )" if lit is None
                                        else f"TREATAS ( {{ {lit} }}, {p.filter_column} )")
        else:
            subs[p.name] = "BLANK ()" if lit is None else lit
    return _PLACEHOLDER_RE.sub(lambda m: subs[m.group(1)], q.body)


def cache_key(q: NamedQuery, sel: Selection, params: dict[str, object], transform: str | None = None) -> tuple:
    return (q.showcase, q.qid, sel.tenant, sel.env, tuple(sorted((k, str(v)) for k, v in params.items())),
            transform)
