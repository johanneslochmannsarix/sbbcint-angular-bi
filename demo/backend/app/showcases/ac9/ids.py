"""AC-9 server-side handles: the tour pseudo-id and the order-token -> ordinal map. One instance per backend app
(Core.extras["ac9"]), so every test app and every backend process starts empty.

- Tour pseudo-id `D-` + 10 hex: HMAC-SHA256 with a random per-instance key over the tour's doi_id (a SaxMS GUID).
  The browser filters and deep-links by it; the router resolves it back to doi_id. Unknown after a restart,
  like the person pseudonyms.
- Order tokens are the core masker's free-text tokens (`T-…`) of the raw order name, the filter handle in every
  mode. `auftrag_liste` and `auftraege` return the order's ordinal `nr` (its rank in the model's sorted name
  list); a transform here records token -> nr per env and swaps `nr` for `auftrag_token`, so no ordinal ever
  leaves the backend. Filtered queries take the ordinal; the router puts it in place of the token.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from typing import Callable

from app.core.masking import Masker

TOUR_ID_RE = re.compile(r"^D-[0-9a-f]{10}$")
DOI_RE = re.compile(r"^[0-9A-Za-z\-]{8,64}$")


class TourIds:
    def __init__(self, key: bytes | None = None):
        self._key = key or secrets.token_bytes(32)
        self._by_doi: dict[str, str] = {}
        self._by_pid: dict[str, str] = {}

    def pid(self, doi_id: str) -> str:
        d = str(doi_id)
        if d in self._by_doi:
            return self._by_doi[d]
        digest = hmac.new(self._key, d.encode("utf-8"), hashlib.sha256).hexdigest()
        p = f"D-{digest[:10]}"
        if p in self._by_pid and self._by_pid[p] != d:           # 40-bit collision: astronomically rare
            raise ValueError("tour pseudo-id collision")
        self._by_doi[d] = p
        self._by_pid[p] = d
        return p

    def resolve(self, pid: str) -> str | None:
        return self._by_pid.get(pid) if TOUR_ID_RE.match(pid or "") else None

    def __len__(self) -> int:
        return len(self._by_pid)


class OrderOrdinals:
    """env -> order token -> ordinal nr. Filled by the transforms of auftrag_liste / auftraege."""

    def __init__(self) -> None:
        self._by_env: dict[str, dict[str, int]] = {}

    def put(self, env: str, token: str, nr: int) -> None:
        self._by_env.setdefault(env, {})[token] = int(nr)

    def get(self, env: str, token: str) -> int | None:
        return self._by_env.get(env, {}).get(token)

    def known(self, env: str) -> bool:
        return bool(self._by_env.get(env))


class Ac9State:
    def __init__(self, masker: Masker):
        self.masker = masker
        self.tours = TourIds()
        self.orders = OrderOrdinals()

    def order_token(self, name: str) -> str:
        """The order's handle in every mode: the core masker's token (what dor_name shows in masked mode). Under
        -Real dor_name carries the name for display, but filters and URLs still use the token (as AC-7 does), so a
        real order name never travels in a URL. Only its ordinal ever reaches the DAX."""
        return self.masker.text_token(str(name))


Transform = Callable[[list[dict], dict], list[dict]]


def tour_id_transform(state: Ac9State) -> Transform:
    """doi_id -> tour (pseudo-id); doi_id is dropped. Rows without a doi_id keep tour = None."""
    def replace_doi(rows: list[dict], _params: dict) -> list[dict]:
        out = []
        for r in rows:
            new = {k: v for k, v in r.items() if k != "doi_id"}
            d = r.get("doi_id")
            new["tour"] = state.tours.pid(d) if d else None
            out.append(new)
        return out
    return replace_doi


def order_capture_transform(state: Ac9State, env: str) -> Transform:
    """Record token -> nr for env, then replace nr by auftrag_token (the filter handle, role id)."""
    def capture_orders(rows: list[dict], _params: dict) -> list[dict]:
        out = []
        for r in rows:
            name, nr = r.get("dor_name"), r.get("nr")
            tok = state.order_token(str(name)) if name else None
            if tok and nr is not None:
                state.orders.put(env, tok, int(nr))
            new = {k: v for k, v in r.items() if k != "nr"}
            new["auftrag_token"] = tok
            out.append(new)
        return out
    return capture_orders
