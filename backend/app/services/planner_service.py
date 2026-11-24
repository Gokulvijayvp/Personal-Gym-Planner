"""Weekly planner business logic: days, muscle groups, exercises, cardio, copy and clear.

Conventions
* A day is identified by (cycle, week_number, day_of_week); no DailySchedule row = nothing planned.
* Every multi-record change runs inside `transaction()` so it is all-or-nothing.
* The session has autoflush off, so we flush explicitly where order matters
  (e.g. delete-then-insert on a unique key, two-phase reorder).
* Plan rows only REFERENCE library exercises; copying a day/week clones the plan rows, so the
  copies never share mutable records with their source.
"""
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.errors import AppError
from app.core.timezone import cycle_date, cycle_end_date
from app.models import (
    CardioActivity, DailySchedule, Exercise, MuscleGroup, ScheduleCardio, ScheduleExercise,
    ScheduleMuscleGroup, WeeklyPlan, WorkoutCycle,
)
from app.models.enums import ScheduleStatus
from app.schemas.common import ErrorDetail
from app.schemas.master_data import CardioActivityRead, MuscleGroupRef, TargetAreaRead, WorkoutTypeRead
from app.schemas.planner import (
    CardioInput, CopyResult, DayCopy, DayDetail, DaySummary, DayUpsert, ExerciseAssignment,
    ExerciseRef, ExerciseOrder, MuscleGroupAssign, ScheduledCardioOut, ScheduledExerciseOut,
    ScheduledMuscleGroupOut, WeekCopy, WeekDetail,
)
from app.services.cycle_service import assert_editable, brief, get_cycle_or_404, transaction

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ---- lookups ------------------------------------------------------------------------------

def _field_error(field: str, message: str) -> ErrorDetail:
    return ErrorDetail(field=field, message=message, type="value_error")


def _week_or_404(db: Session, cycle: WorkoutCycle, week_number: int) -> WeeklyPlan:
    week = db.scalars(select(WeeklyPlan).where(WeeklyPlan.cycle_id == cycle.id,
                                               WeeklyPlan.week_number == week_number)).first()
    if week is None:
        raise AppError(404, f"Week {week_number} does not exist in this cycle "
                            f"(it has {cycle.total_weeks} week(s)).", code="week_not_found")
    return week


def _day_options():
    return (
        selectinload(DailySchedule.muscle_groups).joinedload(ScheduleMuscleGroup.muscle_group),
        selectinload(DailySchedule.muscle_groups).selectinload(ScheduleMuscleGroup.exercises)
        .joinedload(ScheduleExercise.exercise).options(
            joinedload(Exercise.muscle_group), joinedload(Exercise.target_area), joinedload(Exercise.workout_type)),
        selectinload(DailySchedule.cardio_items).joinedload(ScheduleCardio.cardio_activity),
    )


def _find_day(db: Session, week_id: int, day_of_week: int) -> DailySchedule | None:
    return db.execute(
        select(DailySchedule).options(*_day_options()).execution_options(populate_existing=True)
        .where(DailySchedule.weekly_plan_id == week_id, DailySchedule.day_of_week == day_of_week)
    ).unique().scalar_one_or_none()


def _week_days(db: Session, week_id: int) -> dict[int, DailySchedule]:
    rows = db.execute(
        select(DailySchedule).options(*_day_options()).execution_options(populate_existing=True)
        .where(DailySchedule.weekly_plan_id == week_id)
    ).unique().scalars().all()
    return {d.day_of_week: d for d in rows}


def _has_content(day: DailySchedule | None) -> bool:
    return day is not None and bool(
        day.status == ScheduleStatus.rest or day.muscle_groups or day.cardio_items or day.title or day.notes)


def _has_workout(day: DailySchedule | None) -> bool:
    return day is not None and bool(day.muscle_groups or day.cardio_items)


def _ensure_day(db: Session, week: WeeklyPlan, day_of_week: int) -> DailySchedule:
    day = _find_day(db, week.id, day_of_week)
    if day is None:
        day = DailySchedule(weekly_plan_id=week.id, day_of_week=day_of_week, status=ScheduleStatus.planned)
        db.add(day)
        db.flush()
        day = _find_day(db, week.id, day_of_week)
    return day


def _assert_not_rest(day: DailySchedule) -> None:
    if day.status == ScheduleStatus.rest:
        raise AppError(409, "This day is marked as a rest day. Switch it to a workout day before adding a workout.",
                       code="rest_day")


# ---- output builders ----------------------------------------------------------------------

def _kind(day: DailySchedule | None) -> str:
    if day is None:
        return "empty"
    if day.status == ScheduleStatus.rest:
        return "rest"
    if day.muscle_groups and day.cardio_items:
        return "mixed"
    if day.muscle_groups:
        return "strength"
    if day.cardio_items:
        return "cardio"
    return "empty"


def _display_title(day: DailySchedule | None, kind: str) -> str | None:
    if day is None:
        return None
    if day.title:
        return day.title
    if kind == "rest":
        return "Rest day"
    names = [g.muscle_group.name for g in day.muscle_groups]
    if kind == "cardio":
        return "Cardio"
    if kind == "mixed":
        return " + ".join(names + ["Cardio"])
    return " + ".join(names) or None


def _summary_fields(cycle: WorkoutCycle, week_number: int, day_of_week: int, day: DailySchedule | None) -> dict:
    kind = _kind(day)
    status = "unplanned" if day is None else day.status.value
    return dict(
        day_of_week=day_of_week, date=cycle_date(cycle.start_date, week_number, day_of_week),
        schedule_id=day.id if day else None,
        status="unplanned" if (day is not None and kind == "empty" and status == "planned"
                               and not day.title and not day.notes) else status,
        kind=kind, title=day.title if day else None, display_title=_display_title(day, kind),
        notes=day.notes if day else None,
        muscle_groups=[MuscleGroupRef(id=g.muscle_group.id, name=g.muscle_group.name) for g in day.muscle_groups] if day else [],
        exercise_count=sum(len(g.exercises) for g in day.muscle_groups) if day else 0,
        cardio_count=len(day.cardio_items) if day else 0,
    )


def _exercise_out(item: ScheduleExercise) -> ScheduledExerciseOut:
    ex = item.exercise
    return ScheduledExerciseOut(
        id=item.id, order=item.exercise_order,
        exercise=ExerciseRef(
            id=ex.id, name=ex.name, is_active=ex.is_active,
            muscle_group=MuscleGroupRef(id=ex.muscle_group.id, name=ex.muscle_group.name),
            target_area=TargetAreaRead.model_validate(ex.target_area) if ex.target_area else None,
            workout_type=WorkoutTypeRead.model_validate(ex.workout_type) if ex.workout_type else None),
        target_sets=item.target_sets, target_reps=item.target_reps, target_weight_kg=item.target_weight_kg,
        rest_seconds=item.rest_seconds, notes=item.notes)


def _detail(cycle: WorkoutCycle, week_number: int, day_of_week: int, day: DailySchedule | None) -> DayDetail:
    strength = [
        ScheduledMuscleGroupOut(
            id=g.id, muscle_group=MuscleGroupRef(id=g.muscle_group.id, name=g.muscle_group.name), notes=g.notes,
            exercises=[_exercise_out(e) for e in g.exercises])
        for g in (day.muscle_groups if day else [])
    ]
    cardio = [
        ScheduledCardioOut(id=c.id, cardio_activity=CardioActivityRead.model_validate(c.cardio_activity),
                           duration_minutes=c.duration_minutes, distance_km=c.distance_km, notes=c.notes)
        for c in (day.cardio_items if day else [])
    ]
    return DayDetail(cycle_id=cycle.id, week_number=week_number, strength=strength, cardio=cardio,
                     **_summary_fields(cycle, week_number, day_of_week, day))


def _day_response(db: Session, cycle: WorkoutCycle, week: WeeklyPlan, day_of_week: int) -> DayDetail:
    db.expire_all()  # drop anything cached from before this request's writes
    return _detail(cycle, week.week_number, day_of_week, _find_day(db, week.id, day_of_week))


# ---- reads --------------------------------------------------------------------------------

def get_week(db: Session, cycle_id: int, week_number: int) -> WeekDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    week = _week_or_404(db, cycle, week_number)
    days = _week_days(db, week.id)
    return WeekDetail(
        cycle=brief(cycle), week_id=week.id, week_number=week_number, name=week.name, notes=week.notes,
        start_date=cycle_date(cycle.start_date, week_number, 0), end_date=cycle_date(cycle.start_date, week_number, 6),
        days=[DaySummary(**_summary_fields(cycle, week_number, d, days.get(d))) for d in range(7)])


def get_day(db: Session, cycle_id: int, week_number: int, day_of_week: int) -> DayDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    week = _week_or_404(db, cycle, week_number)
    return _day_response(db, cycle, week, day_of_week)


# ---- day level ----------------------------------------------------------------------------

def put_day(db: Session, cycle_id: int, week_number: int, day_of_week: int, data: DayUpsert) -> DayDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    week = _week_or_404(db, cycle, week_number)
    with transaction(db):
        day = _ensure_day(db, week, day_of_week)
        if data.status == "rest" and _has_workout(day):
            if not data.clear_workout:
                raise AppError(409, "This day has a workout. Confirm to remove it and make this a rest day.",
                               code="day_has_workout")
            for group in list(day.muscle_groups):
                db.delete(group)
            for item in list(day.cardio_items):
                db.delete(item)
        day.status = ScheduleStatus.rest if data.status == "rest" else ScheduleStatus.planned
        day.title, day.notes = data.title, data.notes
    return _day_response(db, cycle, week, day_of_week)


def clear_day(db: Session, cycle_id: int, week_number: int, day_of_week: int) -> None:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    week = _week_or_404(db, cycle, week_number)
    with transaction(db):
        day = _find_day(db, week.id, day_of_week)
        if day is not None:
            db.delete(day)


def clear_week(db: Session, cycle_id: int, week_number: int) -> None:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    week = _week_or_404(db, cycle, week_number)
    with transaction(db):
        for day in _week_days(db, week.id).values():
            db.delete(day)


# ---- muscle groups ------------------------------------------------------------------------

def _group_in_day(day: DailySchedule, muscle_group_id: int) -> ScheduleMuscleGroup:
    for g in day.muscle_groups:
        if g.muscle_group_id == muscle_group_id:
            return g
    raise AppError(404, "That muscle group is not part of this day.", code="muscle_group_not_in_day")


def add_muscle_group(db: Session, cycle_id: int, week_number: int, day_of_week: int,
                     data: MuscleGroupAssign) -> DayDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    week = _week_or_404(db, cycle, week_number)
    if db.get(MuscleGroup, data.muscle_group_id) is None:
        raise AppError(422, "Some of the submitted values are invalid.", code="validation_error",
                       details=[_field_error("muscle_group_id", "Muscle group does not exist.")])
    with transaction(db):
        day = _ensure_day(db, week, day_of_week)
        _assert_not_rest(day)
        if any(g.muscle_group_id == data.muscle_group_id for g in day.muscle_groups):
            raise AppError(409, "This muscle group is already part of the day.", code="muscle_group_already_added",
                           details=[_field_error("muscle_group_id", "Already added to this day.")])
        db.add(ScheduleMuscleGroup(daily_schedule_id=day.id, muscle_group_id=data.muscle_group_id, notes=data.notes))
    return _day_response(db, cycle, week, day_of_week)


def remove_muscle_group(db: Session, cycle_id: int, week_number: int, day_of_week: int,
                        muscle_group_id: int) -> DayDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    week = _week_or_404(db, cycle, week_number)
    with transaction(db):
        day = _find_day(db, week.id, day_of_week)
        if day is None:
            raise AppError(404, "That muscle group is not part of this day.", code="muscle_group_not_in_day")
        db.delete(_group_in_day(day, muscle_group_id))  # its exercises are removed with it
    return _day_response(db, cycle, week, day_of_week)


# ---- exercises ----------------------------------------------------------------------------

def _renumber(db: Session, items: list[ScheduleExercise]) -> None:
    """Give `items` the orders 1..n, in list order, without ever violating
    UNIQUE(schedule_muscle_group_id, exercise_order).

    SQLite checks the constraint per statement, so swapping two orders directly would collide.
    Phase 1 parks every row on a unique NEGATIVE order (no live row has one), phase 2 writes the
    final positive values. Both phases run inside the caller's transaction.
    """
    for i, item in enumerate(items, start=1):
        item.exercise_order = -i
    db.flush()
    for i, item in enumerate(items, start=1):
        item.exercise_order = i
    db.flush()


def _check_exercise(db: Session, exercise_id: int, *, keep_if_current: int | None = None) -> Exercise:
    exercise = db.get(Exercise, exercise_id)
    if exercise is None:
        raise AppError(422, "Some of the submitted values are invalid.", code="validation_error",
                       details=[_field_error("exercise_id", "Exercise does not exist.")])
    if not exercise.is_active and exercise_id != keep_if_current:
        raise AppError(422, "Some of the submitted values are invalid.", code="validation_error",
                       details=[_field_error("exercise_id", f"'{exercise.name}' is inactive. Activate it in the "
                                                            "Exercise Library to use it in a plan.")])
    return exercise


def add_exercise(db: Session, cycle_id: int, week_number: int, day_of_week: int, muscle_group_id: int,
                 data: ExerciseAssignment) -> DayDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    week = _week_or_404(db, cycle, week_number)
    _check_exercise(db, data.exercise_id)
    with transaction(db):
        day = _find_day(db, week.id, day_of_week)
        if day is None:
            raise AppError(404, "That muscle group is not part of this day.", code="muscle_group_not_in_day")
        group = _group_in_day(day, muscle_group_id)
        if any(e.exercise_id == data.exercise_id for e in group.exercises):
            raise AppError(409, "This exercise is already in this muscle group for the day.",
                           code="exercise_already_added",
                           details=[_field_error("exercise_id", "Already added to this muscle group.")])
        next_order = (max((e.exercise_order for e in group.exercises), default=0)) + 1
        db.add(ScheduleExercise(
            schedule_muscle_group_id=group.id, exercise_id=data.exercise_id, exercise_order=next_order,
            target_sets=data.target_sets, target_reps=data.target_reps, target_weight_kg=data.target_weight_kg,
            rest_seconds=data.rest_seconds, notes=data.notes))
    return _day_response(db, cycle, week, day_of_week)


def _item_context(db: Session, item_id: int):
    """Walk from a plan row up to (item, group, day, week, cycle)."""
    item = db.get(ScheduleExercise, item_id)
    if item is None:
        raise AppError(404, "Planned exercise not found.", code="schedule_exercise_not_found")
    group = db.get(ScheduleMuscleGroup, item.schedule_muscle_group_id)
    day = db.get(DailySchedule, group.daily_schedule_id)
    week = db.get(WeeklyPlan, day.weekly_plan_id)
    cycle = db.get(WorkoutCycle, week.cycle_id)
    return item, group, day, week, cycle


def update_exercise(db: Session, item_id: int, data: ExerciseAssignment) -> DayDetail:
    item, group, day, week, cycle = _item_context(db, item_id)
    assert_editable(cycle)
    _check_exercise(db, data.exercise_id, keep_if_current=item.exercise_id)
    with transaction(db):
        siblings = db.scalars(select(ScheduleExercise).where(
            ScheduleExercise.schedule_muscle_group_id == group.id, ScheduleExercise.id != item.id)).all()
        if any(s.exercise_id == data.exercise_id for s in siblings):
            raise AppError(409, "This exercise is already in this muscle group for the day.",
                           code="exercise_already_added",
                           details=[_field_error("exercise_id", "Already added to this muscle group.")])
        item.exercise_id = data.exercise_id
        item.target_sets, item.target_reps = data.target_sets, data.target_reps
        item.target_weight_kg, item.rest_seconds, item.notes = data.target_weight_kg, data.rest_seconds, data.notes
    return _day_response(db, cycle, week, day.day_of_week)


def remove_exercise(db: Session, item_id: int) -> DayDetail:
    item, group, day, week, cycle = _item_context(db, item_id)
    assert_editable(cycle)
    with transaction(db):
        db.delete(item)
        db.flush()
        remaining = list(db.scalars(select(ScheduleExercise).where(
            ScheduleExercise.schedule_muscle_group_id == group.id).order_by(ScheduleExercise.exercise_order)))
        _renumber(db, remaining)  # keep orders contiguous (1..n)
    return _day_response(db, cycle, week, day.day_of_week)


def reorder_exercises(db: Session, cycle_id: int, week_number: int, day_of_week: int, muscle_group_id: int,
                      data: ExerciseOrder) -> DayDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    week = _week_or_404(db, cycle, week_number)
    with transaction(db):
        day = _find_day(db, week.id, day_of_week)
        if day is None:
            raise AppError(404, "That muscle group is not part of this day.", code="muscle_group_not_in_day")
        group = _group_in_day(day, muscle_group_id)
        by_id = {e.id: e for e in group.exercises}
        wanted = data.schedule_exercise_ids
        if len(set(wanted)) != len(wanted) or set(wanted) != set(by_id):
            raise AppError(422, "The new order must list every exercise of this muscle group exactly once.",
                           code="order_mismatch",
                           details=[_field_error("schedule_exercise_ids", "Must contain exactly the exercises of this group.")])
        _renumber(db, [by_id[i] for i in wanted])
    return _day_response(db, cycle, week, day_of_week)


# ---- cardio -------------------------------------------------------------------------------

def _check_cardio(db: Session, activity_id: int) -> None:
    if db.get(CardioActivity, activity_id) is None:
        raise AppError(422, "Some of the submitted values are invalid.", code="validation_error",
                       details=[_field_error("cardio_activity_id", "Cardio activity does not exist.")])


def add_cardio(db: Session, cycle_id: int, week_number: int, day_of_week: int, data: CardioInput) -> DayDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    week = _week_or_404(db, cycle, week_number)
    _check_cardio(db, data.cardio_activity_id)
    with transaction(db):
        day = _ensure_day(db, week, day_of_week)
        _assert_not_rest(day)
        order = max((c.sort_order for c in day.cardio_items), default=0) + 1
        db.add(ScheduleCardio(daily_schedule_id=day.id, cardio_activity_id=data.cardio_activity_id,
                              duration_minutes=data.duration_minutes, distance_km=data.distance_km,
                              notes=data.notes, sort_order=order))
    return _day_response(db, cycle, week, day_of_week)


def _cardio_context(db: Session, item_id: int):
    item = db.get(ScheduleCardio, item_id)
    if item is None:
        raise AppError(404, "Planned cardio not found.", code="schedule_cardio_not_found")
    day = db.get(DailySchedule, item.daily_schedule_id)
    week = db.get(WeeklyPlan, day.weekly_plan_id)
    return item, day, week, db.get(WorkoutCycle, week.cycle_id)


def update_cardio(db: Session, item_id: int, data: CardioInput) -> DayDetail:
    item, day, week, cycle = _cardio_context(db, item_id)
    assert_editable(cycle)
    _check_cardio(db, data.cardio_activity_id)
    with transaction(db):
        item.cardio_activity_id, item.duration_minutes = data.cardio_activity_id, data.duration_minutes
        item.distance_km, item.notes = data.distance_km, data.notes
    return _day_response(db, cycle, week, day.day_of_week)


def remove_cardio(db: Session, item_id: int) -> DayDetail:
    item, day, week, cycle = _cardio_context(db, item_id)
    assert_editable(cycle)
    with transaction(db):
        db.delete(item)
    return _day_response(db, cycle, week, day.day_of_week)


# ---- copy ---------------------------------------------------------------------------------

def _clone_exercise(src: ScheduleExercise) -> ScheduleExercise:
    return ScheduleExercise(
        exercise_id=src.exercise_id, exercise_order=src.exercise_order, target_sets=src.target_sets,
        target_reps=src.target_reps, target_weight_kg=src.target_weight_kg, rest_seconds=src.rest_seconds,
        notes=src.notes)


def _clone_day(db: Session, src: DailySchedule, target_week: WeeklyPlan, day_of_week: int) -> DailySchedule:
    """Deep copy of a day's plan rows. Library exercises are referenced, never duplicated."""
    new = DailySchedule(weekly_plan_id=target_week.id, day_of_week=day_of_week, status=src.status,
                        title=src.title, notes=src.notes)
    for group in src.muscle_groups:
        new_group = ScheduleMuscleGroup(muscle_group_id=group.muscle_group_id, notes=group.notes)
        for item in group.exercises:
            new_group.exercises.append(_clone_exercise(item))
        new.muscle_groups.append(new_group)
    for c in src.cardio_items:
        new.cardio_items.append(ScheduleCardio(
            cardio_activity_id=c.cardio_activity_id, duration_minutes=c.duration_minutes,
            distance_km=c.distance_km, notes=c.notes, sort_order=c.sort_order))
    db.add(new)
    return new


def copy_day(db: Session, cycle_id: int, week_number: int, day_of_week: int, data: DayCopy) -> DayDetail:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    source_week = _week_or_404(db, cycle, week_number)
    target_week = _week_or_404(db, cycle, data.target_week_number)
    if (week_number, day_of_week) == (data.target_week_number, data.target_day_of_week):
        raise AppError(422, "Choose a different day to copy to.", code="same_day")
    with transaction(db):
        source = _find_day(db, source_week.id, day_of_week)
        if not _has_content(source):
            raise AppError(422, "There is nothing planned on this day to copy.", code="source_empty")
        target = _find_day(db, target_week.id, data.target_day_of_week)
        if _has_content(target) and not data.overwrite:
            raise AppError(409, f"{DAY_NAMES[data.target_day_of_week]} of week {data.target_week_number} already has a "
                                "plan. Replace it?", code="target_not_empty")
        if target is not None:
            db.delete(target)
            db.flush()  # free the (week, day) unique key before inserting the copy
        _clone_day(db, source, target_week, data.target_day_of_week)
    return _day_response(db, cycle, target_week, data.target_day_of_week)


def copy_week(db: Session, cycle_id: int, week_number: int, data: WeekCopy) -> CopyResult:
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    source_week = _week_or_404(db, cycle, week_number)
    if week_number in data.target_week_numbers:
        raise AppError(422, "A week can't be copied onto itself.", code="same_week")
    targets = [_week_or_404(db, cycle, n) for n in data.target_week_numbers]
    copied = 0
    with transaction(db):
        source_days = {d: day for d, day in _week_days(db, source_week.id).items() if _has_content(day)}
        if not source_days:
            raise AppError(422, "There is nothing planned in this week to copy.", code="source_empty")
        if not data.overwrite:
            busy = [w.week_number for w in targets if any(_has_content(d) for d in _week_days(db, w.id).values())]
            if busy:
                raise AppError(409, "Week(s) " + ", ".join(map(str, busy)) + " already have a plan. Replace it?",
                               code="target_not_empty",
                               details=[_field_error("target_week_numbers", f"Already planned: {busy}")])
        for target in targets:
            for existing in _week_days(db, target.id).values():
                db.delete(existing)
            db.flush()
            for dow, src in source_days.items():
                _clone_day(db, src, target, dow)
                copied += 1
    return CopyResult(copied_days=copied, target_week_numbers=[w.week_number for w in targets])


# ---- public helpers for other read-only features (e.g. the calendar) -----------------------
# The calendar reuses exactly the same day builder, so a day looks identical in both places.
day_load_options = _day_options
build_day_detail = _detail
