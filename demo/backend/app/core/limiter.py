"""Client-side executeQueries limiter, one per backend process (per instance).

executeQueries allows 120 queries / minute / user across all datasets, and every pim session shares that
identity (https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/execute-queries, Limitations).
The per-process budget comes from DEMO_LIMIT_PER_MIN: default 35 (three dev instances in parallel),
dev.ps1 passes 55 (two), run.ps1 passes 110 (the integrated app alone). Never above 110 (PLAN §11.3).
"""
from __future__ import annotations

import collections
import os
import time
from typing import Callable

DEFAULT_PER_MINUTE = 35
MAX_PER_MINUTE = 110
ENV_VAR = "DEMO_LIMIT_PER_MIN"


class RateLimited(Exception):
    """Client-side limiter is full -> HTTP 429."""

    def __init__(self, retry_after_s: float, per_minute: int):
        super().__init__(f"client-side limit of {per_minute} calls/min reached")
        self.retry_after_s = retry_after_s


def per_minute_from_env() -> int:
    raw = os.environ.get(ENV_VAR)
    if raw is None or raw.strip() == "":
        return DEFAULT_PER_MINUTE
    try:
        n = int(raw)
    except ValueError:
        raise ValueError(f"{ENV_VAR} must be an integer, got {raw!r}") from None
    if not 1 <= n <= MAX_PER_MINUTE:
        raise ValueError(f"{ENV_VAR} must be between 1 and {MAX_PER_MINUTE}, got {n}")
    return n


class RateLimiter:
    """Sliding 60 s window. Rejects instead of queueing: a UI waiting a minute is worse than a 429."""

    def __init__(self, per_minute: int | None = None, clock: Callable[[], float] = time.monotonic):
        self.per_minute = per_minute_from_env() if per_minute is None else per_minute
        if not 1 <= self.per_minute <= MAX_PER_MINUTE:
            raise ValueError(f"per_minute must be between 1 and {MAX_PER_MINUTE}")
        self._clock = clock
        self._calls: collections.deque[float] = collections.deque()
        self.total = 0
        self.peak_per_minute = 0

    def _trim(self, now: float) -> None:
        while self._calls and now - self._calls[0] >= 60.0:
            self._calls.popleft()

    def calls_last_minute(self) -> int:
        self._trim(self._clock())
        return len(self._calls)

    def acquire(self) -> None:
        now = self._clock()
        self._trim(now)
        if len(self._calls) >= self.per_minute:
            raise RateLimited(60.0 - (now - self._calls[0]), self.per_minute)
        self._calls.append(now)
        self.total += 1
        self.peak_per_minute = max(self.peak_per_minute, len(self._calls))
