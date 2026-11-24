"""Read-only data for the Home dashboard.

Nothing here owns planning logic. The week (and today) come from the Calendar service, which in turn
uses the Weekly Planner's own day builder; this module only selects the *active* cycle, counts, and
shapes the result. A fixed handful of queries however much is planned.
"""
from datetime import date, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.timezone import cycle_end_date, start_of_week, today_local
from app.models import Exercise, ExerciseSet, WorkoutCycle, WorkoutSession
from app.models.enums import CycleStatus
from app.schemas.dashboard import (
    ActiveCycleCard, ChecklistItem, CycleCounts, DashboardResponse, DashboardStats, SetupStatus, TodayPlan,
    WeekDay, WeekOverview,
)
from app.schemas.planner import DaySummary
from app.services.calendar_service import get_calendar
from app.schemas.workout_log import SessionRef
from app.services import workout_service
from app.services.cycle_service import brief


def _active_card(active: list[WorkoutCycle], today: date) -> ActiveCycleCard | None:
    """Pick the active cycle to feature: the one covering today, else the next to start, else the latest to end."""
    if not active:
        return None
    ends = {c.id: cycle_end_date(c.start_date, c.total_weeks) for c in active}
    covering = [c for c in active if c.start_date <= today <= ends[c.id]]
    if covering:
        cycle, state = max(covering, key=lambda c: c.start_date), "in_progress"
    else:
        upcoming = [c for c in active if c.start_date > today]
        if upcoming:
            cycle, state = min(upcoming, key=lambda c: c.start_date), "upcoming"
        else:
            cycle, state = max(active, key=lambda c: ends[c.id]), "ended"

    total_days = cycle.total_weeks * 7
    if state == "in_progress":
        completed = (today - cycle.start_date).days           # whole days before today
        week = completed // 7 + 1
        remaining, until = total_days - completed, None
    elif state == "upcoming":
        completed, week, remaining, until = 0, None, None, (cycle.start_date - today).days
    else:
        completed, week, remaining, until = total_days, None, None, None
    return ActiveCycleCard(
        cycle=brief(cycle), state=state, current_week=week, total_days=total_days, completed_days=completed,
        progress_percent=completed * 100 // total_days, days_until_start=until, days_remaining=remaining)


def _other_cycle(cycles: list[WorkoutCycle]):
    for status in (CycleStatus.draft, CycleStatus.completed, CycleStatus.archived):
        pool = [c for c in cycles if c.status == status]
        if pool:
            return brief(max(pool, key=lambda c: (c.start_date, c.id)))
    return None


def get_dashboard(db: Session, today: date | None = None) -> DashboardResponse:
    today = today or today_local()
    monday = start_of_week(today)

    # 1 query: every cycle (a tiny table); counts and the featured cycle are derived in Python.
    cycles = list(db.scalars(select(WorkoutCycle).order_by(WorkoutCycle.id)))
    counts = CycleCounts(**{s.value: sum(1 for c in cycles if c.status == s) for s in CycleStatus})
    active = [c for c in cycles if c.status == CycleStatus.active]
    card = _active_card(active, today)

    # 1 query: library size.
    total, active_ex = db.execute(select(
        func.count(Exercise.id), func.coalesce(func.sum(case((Exercise.is_active.is_(True), 1), else_=0)), 0))).one()

    # The Calendar service does the date -> cycle -> planned day mapping for the whole week in a fixed number of queries.
    calendar = get_calendar(db, monday, monday + timedelta(days=6))

    week_days: list[WeekDay] = []
    today_plan = None
    for d in calendar.days:
        is_active = d.cycle is not None and d.cycle.status == CycleStatus.active
        # Only the active cycle's plan is shown as "your plan"; a draft or finished cycle is never presented as current.
        cycle, wk, plan = (d.cycle, d.week_number, d.plan) if is_active else (None, None, None)
        summary = DaySummary.model_validate(plan.model_dump(include=set(DaySummary.model_fields))) if plan else None
        week_days.append(WeekDay(date=d.date, day_of_week=d.day_of_week, is_today=d.date == today, cycle=cycle,
                                 week_number=wk, plan=summary))
        if d.date == today:
            today_plan = TodayPlan(
                date=d.date, day_of_week=d.day_of_week, cycle=cycle, week_number=wk, plan=plan,
                covered_by_inactive=d.cycle if d.cycle is not None and not is_active else None)

    planned = sum(1 for d in week_days if d.plan and d.plan.kind in ("strength", "cardio", "mixed"))
    rest = sum(1 for d in week_days if d.plan and d.plan.kind == "rest")
    planned_exercises = sum(d.plan.exercise_count for d in week_days if d.plan)
    covered_this_week = any(d.cycle is not None for d in week_days)

    sets_count = int(db.scalar(select(func.count(ExerciseSet.id))) or 0)
    non_archived = counts.draft + counts.active + counts.completed
    items = [
        ChecklistItem(key="exercises", status="done" if sets_count else "pending", count=sets_count),
        ChecklistItem(key="cycle", status="done" if non_archived else "pending", count=non_archived),
        ChecklistItem(key="week_plan", count=planned,
                      status=("not_applicable" if not covered_this_week else "done" if planned else "pending"),
                      reason=None if covered_this_week else "No active cycle covers this week yet."),
    ]
    applicable = [i for i in items if i.status != "not_applicable"]
    done = sum(1 for i in applicable if i.status == "done")

    # Logged workouts: today's, anything unfinished (to resume) and the latest completed few. 3-4 small queries.
    def ref(row: WorkoutSession | None) -> SessionRef | None:
        return None if row is None else SessionRef(id=row.id, status=row.status, workout_date=row.workout_date, title=row.title)

    todays = db.scalars(select(WorkoutSession).where(WorkoutSession.workout_date == today, WorkoutSession.status.in_(("in_progress", "completed")))
                        .order_by(WorkoutSession.id.desc())).all()
    todays_best = next((s for s in todays if s.status == "in_progress"), todays[0] if todays else None)

    return DashboardResponse(
        date=today, timezone=settings.timezone, cycle_counts=counts, active_cycle=card,
        other_cycle=None if active else _other_cycle(cycles),
        today=today_plan, week=WeekOverview(start=monday, end=monday + timedelta(days=6), days=week_days),
        stats=DashboardStats(
            exercises_total=int(total), exercises_active=int(active_ex), exercise_sets=sets_count, active_cycles=counts.active,
            planned_days_this_week=planned, rest_days_this_week=rest, planned_exercises_this_week=planned_exercises),
        setup=SetupStatus(items=items, completed=done, applicable=len(applicable), all_done=done == len(applicable)),
        today_workout=ref(todays_best), in_progress_session=ref(workout_service.current_session(db)),
        recent_activity=workout_service.recent_completed(db, 5),
    )
