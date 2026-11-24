"""Workout cycle business logic (cycles, generated weeks, status transitions)."""
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from typing import Iterator

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.timezone import cycle_date, cycle_end_date
from app.models import (
    DailySchedule, ScheduleCardio, ScheduleExercise, ScheduleMuscleGroup, WeeklyPlan, WorkoutCycle,
)
from app.models.enums import CycleStatus, ScheduleStatus
from app.schemas.common import ErrorDetail
from app.schemas.cycle import CycleBrief, CycleDetail, CycleInput, CycleSummary, WeekStats

EDITABLE = (CycleStatus.draft, CycleStatus.active)


@contextmanager
def transaction(db: Session) -> Iterator[None]:
    """All-or-nothing: commit on success, roll back everything on any error."""
    try:
        yield
        db.commit()
    except BaseException:
        db.rollback()
        raise


def get_cycle_or_404(db: Session, cycle_id: int) -> WorkoutCycle:
    cycle = db.get(WorkoutCycle, cycle_id)
    if cycle is None:
        raise AppError(404, "Workout cycle not found.", code="cycle_not_found")
    return cycle


def assert_editable(cycle: WorkoutCycle) -> None:
    if cycle.status not in EDITABLE:
        raise AppError(409, f"This cycle is {cycle.status.value} and can no longer be changed.", code="cycle_locked")


def end_date_of(cycle: WorkoutCycle) -> date:
    return cycle_end_date(cycle.start_date, cycle.total_weeks)


def brief(cycle: WorkoutCycle) -> CycleBrief:
    return CycleBrief(id=cycle.id, name=cycle.name, status=cycle.status, start_date=cycle.start_date,
                      end_date=end_date_of(cycle), total_weeks=cycle.total_weeks)


# ---- statistics ---------------------------------------------------------------------------

@dataclass
class Stats:
    planned_days: int = 0
    rest_days: int = 0
    exercise_count: int = 0
    cardio_count: int = 0


def week_stats(db: Session, cycle_ids: list[int]) -> dict[tuple[int, int], Stats]:
    """(cycle_id, week_number) -> counts. One query, aggregated in Python."""
    if not cycle_ids:
        return {}
    groups = (select(func.count(ScheduleMuscleGroup.id))
              .where(ScheduleMuscleGroup.daily_schedule_id == DailySchedule.id).scalar_subquery())
    cardio = (select(func.count(ScheduleCardio.id))
              .where(ScheduleCardio.daily_schedule_id == DailySchedule.id).scalar_subquery())
    exercises = (select(func.count(ScheduleExercise.id))
                 .join(ScheduleMuscleGroup, ScheduleMuscleGroup.id == ScheduleExercise.schedule_muscle_group_id)
                 .where(ScheduleMuscleGroup.daily_schedule_id == DailySchedule.id).scalar_subquery())
    rows = db.execute(
        select(WeeklyPlan.cycle_id, WeeklyPlan.week_number, DailySchedule.status, groups, cardio, exercises)
        .select_from(DailySchedule).join(WeeklyPlan, WeeklyPlan.id == DailySchedule.weekly_plan_id)
        .where(WeeklyPlan.cycle_id.in_(cycle_ids))
    ).all()
    out: dict[tuple[int, int], Stats] = {}
    for cycle_id, week, status, n_groups, n_cardio, n_ex in rows:
        s = out.setdefault((cycle_id, week), Stats())
        if status == ScheduleStatus.rest:
            s.rest_days += 1
        elif status == ScheduleStatus.planned and (n_groups or n_cardio):
            s.planned_days += 1
        s.exercise_count += n_ex
        s.cardio_count += n_cardio
    return out


def _summary(cycle: WorkoutCycle, stats: dict[tuple[int, int], Stats]) -> dict:
    mine = [stats.get((cycle.id, w), Stats()) for w in range(1, cycle.total_weeks + 1)]
    return dict(
        id=cycle.id, name=cycle.name, description=cycle.description, start_date=cycle.start_date,
        end_date=end_date_of(cycle), total_weeks=cycle.total_weeks, status=cycle.status,
        planned_days=sum(s.planned_days for s in mine), rest_days=sum(s.rest_days for s in mine),
        exercise_count=sum(s.exercise_count for s in mine), cardio_count=sum(s.cardio_count for s in mine),
        created_at=cycle.created_at, updated_at=cycle.updated_at,
    )


# ---- rules --------------------------------------------------------------------------------

def _field_error(field: str, message: str) -> ErrorDetail:
    return ErrorDetail(field=field, message=message, type="value_error")


def _fmt(d: date) -> str:
    return f"{d.day} {d.strftime('%b %Y')}"


def _assert_no_overlap(db: Session, start: date, total_weeks: int, exclude_id: int | None) -> None:
    """Two ACTIVE cycles may not cover the same dates."""
    end = cycle_end_date(start, total_weeks)
    stmt = select(WorkoutCycle).where(WorkoutCycle.status == CycleStatus.active)
    if exclude_id is not None:
        stmt = stmt.where(WorkoutCycle.id != exclude_id)
    for other in db.scalars(stmt):
        if other.start_date <= end and end_date_of(other) >= start:
            raise AppError(
                409,
                f"These dates overlap the active cycle '{other.name}' ({_fmt(other.start_date)} – "
                f"{_fmt(end_date_of(other))}). Complete or archive that cycle first.",
                code="cycle_overlap")


def _assert_unique_name(db: Session, name: str, start: date, exclude_id: int | None) -> None:
    stmt = select(WorkoutCycle.id).where(func.lower(WorkoutCycle.name) == func.lower(name),
                                         WorkoutCycle.start_date == start)
    if exclude_id is not None:
        stmt = stmt.where(WorkoutCycle.id != exclude_id)
    if db.execute(stmt).first() is not None:
        raise AppError(409, f"A cycle named '{name}' starting on {_fmt(start)} already exists.",
                       code="duplicate_cycle",
                       details=[_field_error("name", "A cycle with this name and start date already exists.")])


def _add_weeks(db: Session, cycle: WorkoutCycle, from_week: int, to_week: int) -> None:
    for number in range(from_week, to_week + 1):
        db.add(WeeklyPlan(cycle_id=cycle.id, week_number=number))


# ---- queries ------------------------------------------------------------------------------

def list_cycles(db: Session, status: CycleStatus | None = None) -> list[CycleSummary]:
    stmt = select(WorkoutCycle).order_by(WorkoutCycle.start_date.desc(), WorkoutCycle.id.desc())
    if status is not None:
        stmt = stmt.where(WorkoutCycle.status == status)
    cycles = list(db.scalars(stmt))
    stats = week_stats(db, [c.id for c in cycles])
    return [CycleSummary(**_summary(c, stats)) for c in cycles]


def get_cycle(db: Session, cycle_id: int) -> CycleDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    stats = week_stats(db, [cycle.id])
    weeks = db.scalars(select(WeeklyPlan).where(WeeklyPlan.cycle_id == cycle.id).order_by(WeeklyPlan.week_number)).all()
    return CycleDetail(
        **_summary(cycle, stats),
        weeks=[
            WeekStats(
                id=w.id, week_number=w.week_number, name=w.name, notes=w.notes,
                start_date=cycle_date(cycle.start_date, w.week_number, 0),
                end_date=cycle_date(cycle.start_date, w.week_number, 6),
                **vars(stats.get((cycle.id, w.week_number), Stats())),
            ) for w in weeks
        ],
    )


# ---- commands -----------------------------------------------------------------------------

def create_cycle(db: Session, data: CycleInput) -> CycleDetail:
    _assert_unique_name(db, data.name, data.start_date, None)
    with transaction(db):
        cycle = WorkoutCycle(name=data.name, description=data.description, start_date=data.start_date,
                             total_weeks=data.total_weeks, status=CycleStatus.draft)
        db.add(cycle)
        db.flush()
        _add_weeks(db, cycle, 1, data.total_weeks)  # Week 1..N, however many were asked for
    return get_cycle(db, cycle.id)


def update_cycle(db: Session, cycle_id: int, data: CycleInput) -> CycleDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    _assert_unique_name(db, data.name, data.start_date, cycle.id)
    if cycle.status == CycleStatus.active:
        _assert_no_overlap(db, data.start_date, data.total_weeks, cycle.id)

    with transaction(db):
        if data.total_weeks < cycle.total_weeks:
            busy = [
                n for n, in db.execute(
                    select(WeeklyPlan.week_number)
                    .join(DailySchedule, DailySchedule.weekly_plan_id == WeeklyPlan.id)
                    .where(WeeklyPlan.cycle_id == cycle.id, WeeklyPlan.week_number > data.total_weeks)
                    .group_by(WeeklyPlan.week_number).order_by(WeeklyPlan.week_number))
            ]
            if busy:
                raise AppError(
                    409, "Weeks " + ", ".join(map(str, busy)) + " still have planned days. Clear them before "
                    "making the cycle shorter.", code="weeks_not_empty",
                    details=[_field_error("total_weeks", "Some of the weeks you would remove have a plan.")])
            for week in db.scalars(select(WeeklyPlan).where(WeeklyPlan.cycle_id == cycle.id,
                                                            WeeklyPlan.week_number > data.total_weeks)):
                db.delete(week)
        elif data.total_weeks > cycle.total_weeks:
            _add_weeks(db, cycle, cycle.total_weeks + 1, data.total_weeks)
        cycle.name, cycle.description = data.name, data.description
        cycle.start_date, cycle.total_weeks = data.start_date, data.total_weeks
    return get_cycle(db, cycle.id)


def delete_cycle(db: Session, cycle_id: int) -> None:
    cycle = get_cycle_or_404(db, cycle_id)
    if cycle.status != CycleStatus.draft:
        raise AppError(409, "Only draft cycles can be deleted. Archive this cycle instead to keep your history.",
                       code="cycle_not_deletable")
    with transaction(db):
        db.delete(cycle)  # weeks, days, muscle groups, exercises and cardio go with it


def _transition(db: Session, cycle_id: int, allowed_from: tuple[CycleStatus, ...], to: CycleStatus,
                message: str) -> CycleDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    if cycle.status not in allowed_from:
        raise AppError(409, message, code="invalid_status_transition")
    if to == CycleStatus.active:
        _assert_no_overlap(db, cycle.start_date, cycle.total_weeks, cycle.id)
    with transaction(db):
        cycle.status = to
    return get_cycle(db, cycle.id)


def activate_cycle(db: Session, cycle_id: int) -> CycleDetail:
    return _transition(db, cycle_id, (CycleStatus.draft,), CycleStatus.active, "Only a draft cycle can be activated.")


def complete_cycle(db: Session, cycle_id: int) -> CycleDetail:
    return _transition(db, cycle_id, (CycleStatus.active,), CycleStatus.completed, "Only an active cycle can be completed.")


def archive_cycle(db: Session, cycle_id: int) -> CycleDetail:
    return _transition(db, cycle_id, (CycleStatus.draft, CycleStatus.active, CycleStatus.completed),
                       CycleStatus.archived, "This cycle is already archived.")
