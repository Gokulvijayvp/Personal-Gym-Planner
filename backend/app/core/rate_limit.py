"""A small in-memory sliding-window rate limiter.

Fine for this app, which runs as one process. If you ever run several workers or servers, move the counters to a
shared store (such as Redis): each process would otherwise count on its own.

Memory: every counter remembers its window, and a sweep (at most once a minute) forgets counters whose events have all
expired, so the table does not grow with the number of different emails and addresses that ever visited.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import settings
from app.core.errors import AppError

SWEEP_EVERY_SECONDS = 60

_hits: dict[str, deque[float]] = defaultdict(deque)
_windows: dict[str, int] = {}
_last_sweep = 0.0
_lock = threading.Lock()


def reset() -> None:
    """Forget every counter (used by the tests)."""
    global _last_sweep
    with _lock:
        _hits.clear()
        _windows.clear()
        _last_sweep = 0.0


def size() -> int:
    """How many counters are currently remembered (used by the tests)."""
    with _lock:
        return len(_hits)


def client_ip(request: Request) -> str:
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[-1].strip()     # the address our own proxy saw; earlier entries can be forged
    return request.client.host if request.client else "unknown"


def _sweep(now: float) -> None:
    """Drop expired events, then drop counters that have none left. Caller holds the lock."""
    global _last_sweep
    _last_sweep = now
    for key in list(_hits):
        q, window = _hits[key], _windows.get(key, 0)
        while q and now - q[0] >= window:
            q.popleft()
        if not q:
            del _hits[key]
            _windows.pop(key, None)


def hit(key: str, limit: int, window_seconds: int, message: str = "Too many requests. Please slow down and try again shortly.") -> None:
    """Count one event for `key`; raise 429 (with Retry-After) once more than `limit` happened in the window."""
    now = time.monotonic()
    with _lock:
        if now - _last_sweep >= SWEEP_EVERY_SECONDS:
            _sweep(now)
        q = _hits[key]
        _windows[key] = window_seconds
        while q and now - q[0] >= window_seconds:
            q.popleft()
        if len(q) >= limit:
            retry = max(1, int(window_seconds - (now - q[0])))
            raise AppError(429, message, code="rate_limited", headers={"Retry-After": str(retry)})
        q.append(now)
