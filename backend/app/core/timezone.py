"""Timezone-aware date/time helpers.

Conventions (single source of truth for the whole backend):

* **Storage**: every ``DateTime`` column holds *naive UTC*. SQLite has no timezone
  type, so we fix the meaning by convention instead of changing the columns.
  Use :func:`utc_now_naive` for defaults and :func:`to_utc_naive` before writing.
* **API output**: datetimes are serialised as timezone-aware UTC ISO strings
  (``...Z``) via :data:`app.schemas.common.UtcDateTime`; clients convert for display.
* **Calendar dates** (``Date`` columns such as ``workout_date``) are *local* dates in
  the application timezone (``settings.timezone``, Asia/Kolkata). Always obtain
  "today" from :func:`today_local`, never from ``date.today()`` (server clock zone).
"""
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import settings

UTC = timezone.utc


@lru_cache
def get_app_tz() -> ZoneInfo:
    """The application timezone. Fails fast with a clear message if misconfigured."""
    try:
        return ZoneInfo(settings.timezone)
    except ZoneInfoNotFoundError as exc:  # e.g. typo, or `tzdata` missing on Windows
        raise RuntimeError(
            f"Unknown timezone '{settings.timezone}'. Check TIMEZONE in .env and that the "
            "'tzdata' package is installed (required on Windows)."
        ) from exc


def utc_now() -> datetime:
    """Current moment as an aware UTC datetime."""
    return datetime.now(UTC)


def utc_now_naive() -> datetime:
    """Current moment as naive UTC, the storage format for DateTime columns."""
    return utc_now().replace(tzinfo=None)


def to_utc_naive(value: datetime) -> datetime:
    """Normalise to naive UTC for storage. Naive input is assumed to already be UTC."""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def to_utc(value: datetime) -> datetime:
    """Aware UTC datetime. Naive input is assumed to be UTC (i.e. read from storage)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def to_local(value: datetime, tz: ZoneInfo | None = None) -> datetime:
    """Convert a stored/aware datetime to the application timezone for display."""
    return to_utc(value).astimezone(tz or get_app_tz())


def now_local(now: datetime | None = None) -> datetime:
    """Current local time. ``now`` is injectable for tests."""
    return to_local(now if now is not None else utc_now())


def today_local(now: datetime | None = None) -> date:
    """Today's calendar date in the application timezone (not the server's)."""
    return now_local(now).date()


def start_of_week(day: date) -> date:
    """Monday of the week containing ``day`` (matches DailySchedule: Monday=0)."""
    return day - timedelta(days=day.weekday())


def local_day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """[start, end) of a local calendar day as naive UTC, for querying timestamp columns."""
    tz = get_app_tz()
    start = datetime.combine(day, time.min, tzinfo=tz)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    return to_utc_naive(start), to_utc_naive(end)


# ---- workout cycle calendar rules ---------------------------------------------------------
# A cycle starts on a Monday and every cycle week runs Monday..Sunday, so a date maps to
# (week_number, day_of_week) with plain integer maths and no timezone involved (all values
# here are local calendar dates).

def is_monday(day: date) -> bool:
    return day.weekday() == 0


def cycle_end_date(start: date, total_weeks: int) -> date:
    """Last day (a Sunday) of a cycle: start + 7*weeks - 1 days."""
    return start + timedelta(days=7 * total_weeks - 1)


def cycle_date(start: date, week_number: int, day_of_week: int) -> date:
    """Calendar date of a cycle slot. week_number is 1-based, day_of_week Monday=0."""
    return start + timedelta(days=7 * (week_number - 1) + day_of_week)


def cycle_slot(start: date, day: date) -> tuple[int, int] | None:
    """Inverse of cycle_date: (week_number, day_of_week) for a date, or None before the start."""
    offset = (day - start).days
    if offset < 0:
        return None
    return offset // 7 + 1, offset % 7
