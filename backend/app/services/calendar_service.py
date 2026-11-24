"""Read-only calendar: maps dates onto Workout Cycles and shows what the Weekly Planner holds.

The planner stays the single source of truth. This module only *reads*: it finds which cycle(s)
cover each date, loads the planned days in a fixed number of queries, and renders them with the
planner's own day builder.
"""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.timezone import cycle_end_date, cycle_slot, today_local
from app.models import DailySchedule, WeeklyPlan, WorkoutCycle, WorkoutSession
from app.models.enums import CycleStatus
from app.schemas.calendar import CalendarDay, CalendarResponse
from app.schemas.common import ErrorDetail
from app.schemas.workout_log import SessionRef
from app.services.cycle_service import brief
from app.services.planner_service import build_day_detail, day_load_options

MAX_RANGE_DAYS = 62            # two months + a bit: enough for a 6-week month grid
MIN_YEAR, MAX_YEAR = 2000, 2100

# When several cycles cover the same date, show the one that matters most.
_PRIORITY = {CycleStatus.active: 0, CycleStatus.completed: 1, CycleStatus.draft: 2, CycleStatus.archived: 3}


def _invalid(field: str, message: str) -> AppError:
    return AppError(422, "Some of the submitted values are invalid.", code="validation_error",
                    details=[ErrorDetail(field=field, message=message, type="value_error")])


def validate_range(start: date, end: date) -> None:
    for name, value in (("start", start), ("end", end)):
        if not MIN_YEAR <= value.year <= MAX_YEAR:
            raise _invalid(name, f"Date must be between the years {MIN_YEAR} and {MAX_YEAR}.")
    if end < start:
        raise _invalid("end", "End date must be on or after the start date.")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise _invalid("end", f"The range can cover at most {MAX_RANGE_DAYS} days.")


def get_calendar(db: Session, start: date, end: date) -> CalendarResponse:
    validate_range(start, end)

    # 1 query: cycles that could overlap the range (end date is checked in Python).
    candidates = db.scalars(select(WorkoutCycle).where(WorkoutCycle.start_date <= end).order_by(WorkoutCycle.id)).all()
    cycles = [c for c in candidates if cycle_end_date(c.start_date, c.total_weeks) >= start]

    # date -> every (cycle, week, weekday) slot covering it
    covering: dict[date, list[tuple[WorkoutCycle, int, int]]] = {}
    wanted_weeks: set[int] = set()
    day = start
    while day <= end:
        for cycle in cycles:
            slot = cycle_slot(cycle.start_date, day)
            if slot is not None and slot[0] <= cycle.total_weeks:
                covering.setdefault(day, []).append((cycle, slot[0], slot[1]))
                wanted_weeks.add(slot[0])
        day += timedelta(days=1)

    plans: dict[tuple[int, int], WeeklyPlan] = {}
    schedules: dict[tuple[int, int], DailySchedule] = {}
    if covering:
        # 1 query: the weeks involved; 1 query (+ the planner's eager loads): all their days.
        weeks = db.scalars(select(WeeklyPlan).where(
            WeeklyPlan.cycle_id.in_([c.id for c in cycles]),
            WeeklyPlan.week_number.between(min(wanted_weeks), max(wanted_weeks)))).all()
        plans = {(w.cycle_id, w.week_number): w for w in weeks}
        if plans:
            rows = db.execute(
                select(DailySchedule).options(*day_load_options())
                .where(DailySchedule.weekly_plan_id.in_([w.id for w in plans.values()]))
            ).unique().scalars().all()
            schedules = {(d.weekly_plan_id, d.day_of_week): d for d in rows}

    # 1 query: logged workouts in the range (an unfinished one wins over a completed one on the same date).
    logged: dict[date, SessionRef] = {}
    rank = {"in_progress": 0, "completed": 1}
    for row in db.scalars(select(WorkoutSession).where(
            WorkoutSession.workout_date.between(start, end), WorkoutSession.status.in_(tuple(rank))).order_by(WorkoutSession.id.desc())):
        best = logged.get(row.workout_date)
        if best is None or rank[row.status] < rank[best.status]:
            logged[row.workout_date] = SessionRef(id=row.id, status=row.status, workout_date=row.workout_date, title=row.title)

    days: list[CalendarDay] = []
    day = start
    while day <= end:
        slots = sorted(covering.get(day, []), key=lambda s: (_PRIORITY[s[0].status], -s[0].id))
        if not slots:
            days.append(CalendarDay(date=day, day_of_week=day.weekday(), cycle=None, week_number=None,
                                    also_covered_by=[], plan=None, workout=logged.get(day)))
        else:
            cycle, week_number, dow = slots[0]
            plan_row = plans.get((cycle.id, week_number))
            row = schedules.get((plan_row.id, dow)) if plan_row else None
            days.append(CalendarDay(
                date=day, day_of_week=dow, cycle=brief(cycle), week_number=week_number,
                also_covered_by=[brief(c) for c, _, _ in slots[1:]],
                plan=build_day_detail(cycle, week_number, dow, row), workout=logged.get(day)))
        day += timedelta(days=1)

    return CalendarResponse(start=start, end=end, timezone=settings.timezone, today=today_local(), days=days)
