"""In-memory response cache: TTL 10 min, key = (showcase, query, dataset, params[, transform]).

Only masked payloads are stored (the service masks before put). `?fresh=1` bypasses the read, not the write.
"""
from __future__ import annotations

import asyncio
import time
from typing import Callable

CACHE_TTL_S = 600


class ResponseCache:
    def __init__(self, ttl_s: float = CACHE_TTL_S, clock: Callable[[], float] = time.monotonic):
        self.ttl_s = ttl_s
        self._clock = clock
        self._data: dict[tuple, tuple[float, dict]] = {}
        self._locks: dict[tuple, asyncio.Lock] = {}

    def get(self, key: tuple) -> dict | None:
        hit = self._data.get(key)
        if hit and self._clock() < hit[0]:
            return hit[1]
        if hit:
            del self._data[key]
        return None

    def put(self, key: tuple, value: dict) -> None:
        self._data[key] = (self._clock() + self.ttl_s, value)

    def lock(self, key: tuple) -> asyncio.Lock:
        return self._locks.setdefault(key, asyncio.Lock())

    def __len__(self) -> int:
        now = self._clock()
        for k in [k for k, (exp, _) in self._data.items() if exp <= now]:
            del self._data[k]
        return len(self._data)
