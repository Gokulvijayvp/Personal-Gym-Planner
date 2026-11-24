import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core import timezone as tz
from app.db.base import Base
from app.models import MuscleGroup
from app.schemas.common import UtcDateTime

IST = ZoneInfo("Asia/Kolkata")
BACKEND = Path(__file__).resolve().parents[1]


def utc(*a) -> datetime:
    return datetime(*a, tzinfo=timezone.utc)


def test_app_timezone_is_kolkata():
    assert str(tz.get_app_tz()) == "Asia/Kolkata"


def test_utc_now_variants():
    assert tz.utc_now().tzinfo is not None and tz.utc_now().utcoffset() == timedelta(0)
    assert tz.utc_now_naive().tzinfo is None
    assert abs(tz.utc_now_naive() - tz.utc_now().replace(tzinfo=None)) < timedelta(seconds=2)


def test_to_local_adds_530_offset():
    local = tz.to_local(utc(2026, 11, 18, 8, 0))
    assert (local.hour, local.minute) == (13, 30)
    assert local.utcoffset() == timedelta(hours=5, minutes=30)


def test_naive_values_are_treated_as_utc():
    # What the DB returns: naive UTC.
    assert tz.to_local(datetime(2026, 11, 18, 8, 0)).hour == 13
    assert tz.to_utc(datetime(2026, 11, 18, 8, 0)).tzinfo == timezone.utc


def test_to_utc_naive_round_trip():
    ist_dt = datetime(2026, 11, 19, 1, 30, tzinfo=IST)
    stored = tz.to_utc_naive(ist_dt)
    assert stored == datetime(2026, 11, 18, 20, 0) and stored.tzinfo is None
    assert tz.to_utc_naive(stored) == stored  # idempotent for naive input
    assert tz.to_local(stored) == ist_dt


@pytest.mark.parametrize("now_utc, expected", [
    # 20:00 UTC on the 18th is already 01:30 on the 19th in India  -> the classic off-by-one.
    (utc(2026, 11, 18, 20, 0), date(2026, 11, 19)),
    (utc(2026, 11, 18, 18, 29, 59), date(2026, 11, 18)),   # 23:59:59 IST
    (utc(2026, 11, 18, 18, 30, 0), date(2026, 11, 19)),    # 00:00:00 IST exactly
    (utc(2026, 11, 18, 0, 0), date(2026, 11, 18)),
    (utc(2026, 12, 31, 19, 0), date(2027, 1, 1)),          # year boundary
    (utc(2028, 2, 28, 19, 0), date(2028, 2, 29)),          # leap day
])
def test_today_local_boundaries(now_utc, expected):
    assert tz.today_local(now_utc) == expected


def test_today_local_ignores_server_timezone(monkeypatch):
    # Even if the host machine were set to another zone, result depends only on the instant.
    now = utc(2026, 11, 18, 20, 0)
    assert tz.today_local(now) == tz.to_local(now).date() == date(2026, 11, 19)


def test_start_of_week_monday_based():
    assert tz.start_of_week(date(2026, 11, 18)) == date(2026, 11, 16)  # Wed -> Mon
    assert tz.start_of_week(date(2026, 11, 16)) == date(2026, 11, 16)  # Mon -> Mon
    assert tz.start_of_week(date(2026, 11, 22)) == date(2026, 11, 16)  # Sun -> Mon
    assert date(2026, 11, 16).weekday() == 0                            # DailySchedule: Monday=0


def test_local_day_bounds_are_utc_and_24h():
    start, end = tz.local_day_bounds_utc(date(2026, 11, 19))
    assert start == datetime(2026, 11, 18, 18, 30) and end == datetime(2026, 11, 19, 18, 30)
    # A log written at 01:30 IST on the 19th (20:00 UTC on the 18th) belongs to the 19th.
    assert start <= datetime(2026, 11, 18, 20, 0) < end


def test_utc_datetime_serialises_with_z():
    class M(BaseModel):
        at: UtcDateTime

    assert M(at=datetime(2026, 11, 18, 20, 0)).model_dump(mode="json")["at"] == "2026-11-18T20:00:00Z"
    assert M(at=datetime(2026, 11, 19, 1, 30, tzinfo=IST)).model_dump(mode="json")["at"] == "2026-11-18T20:00:00Z"


def test_invalid_timezone_fails_clearly(monkeypatch):
    tz.get_app_tz.cache_clear()
    monkeypatch.setattr(tz.settings, "timezone", "Mars/Olympus")
    with pytest.raises(RuntimeError, match="Unknown timezone 'Mars/Olympus'"):
        tz.get_app_tz()
    tz.get_app_tz.cache_clear()


def test_model_timestamps_are_naive_utc_and_updated_on_change():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        g = MuscleGroup(name="Test", sort_order=1)
        s.add(g)
        s.commit()
        assert g.created_at.tzinfo is None
        assert abs(g.created_at - tz.utc_now_naive()) < timedelta(seconds=5)
        first = g.updated_at
        g.description = "changed"
        s.commit()
        assert g.updated_at >= first


def test_no_deprecated_utcnow_in_code():
    offenders = []
    for folder in ("app", "migrations"):
        for path in (BACKEND / folder).rglob("*.py"):
            if re.search(r"\.utcnow\(|\.utcnow\b", path.read_text(encoding="utf-8")):
                offenders.append(str(path.relative_to(BACKEND)))
    assert offenders == []
