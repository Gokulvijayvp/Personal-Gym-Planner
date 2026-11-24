"""Workout logging: starting sessions from a plan or blank, logging sets and cardio, completing, history.

Rules live here (not in the UI):
* A session is editable only while ``in_progress``; completed / cancelled sessions reject every change (409).
* Planned values are *copied* when a session starts; nothing here ever writes to the planner or the library.
* At most one unfinished session per date (database-enforced); a repeated start returns the existing one.
"""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import and_, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.core.timezone import cycle_date, today_local, utc_now_naive
from app.models import (
    CardioActivity, DailySchedule, Exercise, WeeklyPlan, WorkoutCycle, WorkoutSession, WorkoutSessionCardio,
    WorkoutSessionExercise, WorkoutSessionSet,
)
from app.models.enums import CycleStatus, ScheduleStatus
from app.schemas.common import ErrorDetail
from app.schemas.workout_log import (
    CardioAdd, CardioOut, CardioUpdate, CancelInput, CompleteInput, ExerciseAdd, ExerciseOut, ExerciseUpdate, RecentSession,
    ReorderInput, SessionDetail, SessionList, SessionListItem, SessionSummary, SetOut, SetUpdate, StartInput,
)
from app.services.planner_service import day_load_options

IN_PROGRESS, COMPLETED, CANCELLED = "in_progress", "completed", "cancelled"
MAX_EXERCISES, MAX_SETS, MAX_CARDIO = 60, 30, 20
RENUMBER_OFFSET = 1000


# ---- errors ------------------------------------------------------------------------------------

def _invalid(field: str, message: str) -> AppError:
    return AppError(422, "Some of the submitted values are invalid.", code="validation_error",
                    details=[ErrorDetail(field=field, message=message, type="value_error")])


def _not_found(what: str) -> AppError:
    return AppError(404, f"{what} not found.", code=f"{what.lower().replace(' ', '_')}_not_found")


def _commit(db: Session) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


# ---- loading and presenting -----------------------------------------------------------------------

def _load(db: Session, session_id: int) -> WorkoutSession:
    row = db.execute(
        select(WorkoutSession).options(
            selectinload(WorkoutSession.exercises).selectinload(WorkoutSessionExercise.sets),
            selectinload(WorkoutSession.cardio))
        .execution_options(populate_existing=True).where(WorkoutSession.id == session_id)
    ).scalar_one_or_none()
    if row is None:
        raise _not_found("Workout session")
    return row


def _editable(db: Session, session_id: int) -> WorkoutSession:
    session = _load(db, session_id)
    if session.status != IN_PROGRESS:
        raise AppError(409, f"This workout is {session.status.replace('_', ' ')} and can no longer be changed.",
                       code="session_locked")
    return session


def duration_seconds(session: WorkoutSession, now: datetime | None = None) -> int:
    end = session.ended_at or now or utc_now_naive()
    return max(0, int((end - session.started_at).total_seconds()))


def _f(value: Decimal | None) -> float | None:
    return None if value is None else float(value)


def _set_out(s: WorkoutSessionSet) -> SetOut:
    return SetOut(id=s.id, set_number=s.set_number, status=s.status, target_reps=s.target_reps,
                  target_weight_kg=_f(s.target_weight_kg), actual_reps=s.actual_reps,
                  actual_weight_kg=_f(s.actual_weight_kg), rest_seconds=s.rest_seconds, notes=s.notes)


def _exercise_out(e: WorkoutSessionExercise) -> ExerciseOut:
    return ExerciseOut(
        id=e.id, position=e.position, exercise_id=e.exercise_id, exercise_name=e.exercise_name,
        muscle_group_name=e.muscle_group_name, workout_type_name=e.workout_type_name, status=e.status,
        from_plan=e.target_sets is not None, target_sets=e.target_sets, target_reps=e.target_reps,
        target_weight_kg=_f(e.target_weight_kg), target_rest_seconds=e.target_rest_seconds, plan_notes=e.plan_notes,
        notes=e.notes, sets=[_set_out(s) for s in e.sets])


def _cardio_out(c: WorkoutSessionCardio) -> CardioOut:
    return CardioOut(
        id=c.id, position=c.position, cardio_activity_id=c.cardio_activity_id, activity_name=c.activity_name,
        status=c.status, from_plan=c.target_duration_minutes is not None, target_duration_minutes=c.target_duration_minutes,
        target_distance_km=_f(c.target_distance_km), plan_notes=c.plan_notes, duration_minutes=c.duration_minutes,
        distance_km=_f(c.distance_km), calories=c.calories, speed_kmh=_f(c.speed_kmh), resistance=c.resistance, notes=c.notes)


def summarize(session: WorkoutSession) -> SessionSummary:
    done_cardio = [c for c in session.cardio if c.status == "completed"]
    return SessionSummary(
        total_exercises=len(session.exercises),
        completed_exercises=sum(1 for e in session.exercises if e.status == "completed"),
        skipped_exercises=sum(1 for e in session.exercises if e.status == "skipped"),
        total_sets=sum(len(e.sets) for e in session.exercises),
        completed_sets=sum(1 for e in session.exercises for s in e.sets if s.status == "completed"),
        cardio_entries=len(session.cardio), cardio_completed=len(done_cardio),
        cardio_minutes=sum(c.duration_minutes or 0 for c in done_cardio))


def to_detail(session: WorkoutSession) -> SessionDetail:
    return SessionDetail(
        id=session.id, workout_date=session.workout_date, status=session.status, source=session.source, title=session.title,
        cycle_name=session.cycle_name, week_number=session.week_number, daily_schedule_id=session.daily_schedule_id,
        started_at=session.started_at, ended_at=session.ended_at, duration_seconds=duration_seconds(session),
        notes=session.notes, cancel_reason=session.cancel_reason, summary=summarize(session),
        exercises=[_exercise_out(e) for e in session.exercises], cardio=[_cardio_out(c) for c in session.cardio],
        updated_at=session.updated_at)


def get_session(db: Session, session_id: int) -> SessionDetail:
    return to_detail(_load(db, session_id))


def _touch(session: WorkoutSession) -> None:
    session.updated_at = utc_now_naive()


# ---- starting ----------------------------------------------------------------------------------------

def find_active(db: Session, workout_date: date) -> WorkoutSession | None:
    return db.execute(select(WorkoutSession).where(
        WorkoutSession.workout_date == workout_date, WorkoutSession.status == IN_PROGRESS)).scalar_one_or_none()


def current_session(db: Session) -> WorkoutSession | None:
    """The unfinished session to resume (the most recent one), whatever its date."""
    return db.execute(select(WorkoutSession).where(WorkoutSession.status == IN_PROGRESS)
                      .order_by(WorkoutSession.workout_date.desc(), WorkoutSession.id.desc()).limit(1)).scalar_one_or_none()


def _plan_day(db: Session, data: StartInput) -> tuple[WorkoutCycle, DailySchedule, date]:
    cycle = db.get(WorkoutCycle, data.cycle_id)
    if cycle is None:
        raise AppError(404, "Workout cycle not found.", code="cycle_not_found")
    if cycle.status not in (CycleStatus.active, CycleStatus.completed):
        raise AppError(409, f"A workout can only be started from an active or completed cycle; this one is {cycle.status.value}.",
                       code="cycle_not_usable")
    if data.week_number > cycle.total_weeks:
        raise _invalid("week_number", f"This cycle has {cycle.total_weeks} weeks.")
    day = db.execute(
        select(DailySchedule).options(*day_load_options()).join(WeeklyPlan, WeeklyPlan.id == DailySchedule.weekly_plan_id)
        .where(WeeklyPlan.cycle_id == cycle.id, WeeklyPlan.week_number == data.week_number,
               DailySchedule.day_of_week == data.day_of_week)).unique().scalar_one_or_none()
    when = cycle_date(cycle.start_date, data.week_number, data.day_of_week)
    if day is None or day.status == ScheduleStatus.rest or not (day.muscle_groups or day.cardio_items):
        what = "a rest day" if day is not None and day.status == ScheduleStatus.rest else "nothing planned"
        raise AppError(422, f"That day has {what}, so there is no workout to start. Start a blank workout instead.",
                       code="nothing_to_start")
    return cycle, day, when


def _copy_plan(session: WorkoutSession, day: DailySchedule) -> None:
    position = 0
    for group in day.muscle_groups:
        for item in group.exercises:
            position += 1
            ex = WorkoutSessionExercise(
                exercise_id=item.exercise_id, schedule_exercise_id=item.id, position=position, status="pending",
                exercise_name=item.exercise.name, muscle_group_name=group.muscle_group.name,
                workout_type_name=item.exercise.workout_type.name if item.exercise.workout_type else None,
                target_sets=item.target_sets, target_reps=item.target_reps, target_weight_kg=_dec(item.target_weight_kg),
                target_rest_seconds=item.rest_seconds, plan_notes=item.notes)
            ex.sets = [WorkoutSessionSet(set_number=n, status="pending", target_reps=item.target_reps,
                                         target_weight_kg=_dec(item.target_weight_kg)) for n in range(1, item.target_sets + 1)]
            session.exercises.append(ex)
    for n, item in enumerate(day.cardio_items, start=1):
        session.cardio.append(WorkoutSessionCardio(
            cardio_activity_id=item.cardio_activity_id, schedule_cardio_id=item.id, position=n, status="pending",
            activity_name=item.cardio_activity.name, target_duration_minutes=item.duration_minutes,
            target_distance_km=_dec(item.distance_km), plan_notes=item.notes))


def _dec(value) -> Decimal | None:
    return None if value is None else Decimal(str(round(float(value), 3)))


def start_session(db: Session, data: StartInput) -> tuple[SessionDetail, bool]:
    """Returns (session, created). Repeating the same start returns the unfinished session instead of a duplicate."""
    today = today_local()
    schedule_id = None
    extras = {}
    if data.source == "plan":
        cycle, day, when = _plan_day(db, data)
        schedule_id = day.id
        extras = dict(title=day.title, cycle_name=cycle.name, week_number=data.week_number)
    else:
        when = data.workout_date or today
    if when > today:
        raise _invalid("workout_date", "A workout can't be started for a future date.")

    for attempt in range(2):
        existing = find_active(db, when)
        if existing is not None:
            if existing.daily_schedule_id == schedule_id and existing.source == data.source:
                return to_detail(_load(db, existing.id)), False
            raise AppError(409, f"A workout is already in progress for {when.isoformat()}. Finish or cancel it first.",
                           code="session_in_progress",
                           details=[ErrorDetail(field="session_id", message=str(existing.id), type="existing_session")])
        session = WorkoutSession(daily_schedule_id=schedule_id, source=data.source, workout_date=when, status=IN_PROGRESS,
                                 started_at=utc_now_naive(), **extras)
        if data.source == "plan":
            _copy_plan(session, day)
        db.add(session)
        try:
            db.commit()                                    # the session and everything copied into it: one transaction
        except IntegrityError:                             # a concurrent start won the race: look again
            db.rollback()
            if attempt == 1:
                raise
            continue
        return to_detail(_load(db, session.id)), True
    raise AssertionError("unreachable")


# ---- exercises ----------------------------------------------------------------------------------------

def _get_exercise(session: WorkoutSession, exercise_id: int) -> WorkoutSessionExercise:
    for e in session.exercises:
        if e.id == exercise_id:
            return e
    raise _not_found("Logged exercise")


def add_exercise(db: Session, session_id: int, data: ExerciseAdd) -> SessionDetail:
    session = _editable(db, session_id)
    if len(session.exercises) >= MAX_EXERCISES:
        raise AppError(409, f"A workout can have at most {MAX_EXERCISES} exercises.", code="limit_reached")
    library = db.execute(select(Exercise).where(Exercise.id == data.exercise_id)).scalar_one_or_none()
    if library is None:
        raise AppError(404, "Exercise not found in the library.", code="exercise_not_found")
    if not library.is_active:
        raise _invalid("exercise_id", "This exercise is inactive. Reactivate it in the Exercise Library first.")
    ex = WorkoutSessionExercise(
        exercise_id=library.id, position=max((e.position for e in session.exercises), default=0) + 1, status="pending",
        exercise_name=library.name, muscle_group_name=library.muscle_group.name,
        workout_type_name=library.workout_type.name if library.workout_type else None)
    ex.sets = [WorkoutSessionSet(set_number=1, status="pending")]
    session.exercises.append(ex)
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


def update_exercise(db: Session, session_id: int, exercise_id: int, data: ExerciseUpdate) -> SessionDetail:
    session = _editable(db, session_id)
    ex = _get_exercise(session, exercise_id)
    for field in data.model_fields_set:
        setattr(ex, field, getattr(data, field))
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


def remove_exercise(db: Session, session_id: int, exercise_id: int) -> SessionDetail:
    session = _editable(db, session_id)
    ex = _get_exercise(session, exercise_id)
    session.exercises.remove(ex)
    for n, e in enumerate(session.exercises, start=1):
        e.position = n
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


def reorder_exercises(db: Session, session_id: int, data: ReorderInput) -> SessionDetail:
    session = _editable(db, session_id)
    current = {e.id: e for e in session.exercises}
    if sorted(data.exercise_ids) != sorted(current) or len(set(data.exercise_ids)) != len(data.exercise_ids):
        raise _invalid("exercise_ids", "Send every exercise of this workout exactly once.")
    for n, exercise_id in enumerate(data.exercise_ids, start=1):
        current[exercise_id].position = n
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


# ---- sets ---------------------------------------------------------------------------------------------

def add_set(db: Session, session_id: int, exercise_id: int) -> SessionDetail:
    for attempt in range(3):
        session = _editable(db, session_id)
        ex = _get_exercise(session, exercise_id)
        if len(ex.sets) >= MAX_SETS:
            raise AppError(409, f"An exercise can have at most {MAX_SETS} sets.", code="limit_reached")
        ex.sets.append(WorkoutSessionSet(
            set_number=max((s.set_number for s in ex.sets), default=0) + 1, status="pending",
            target_reps=ex.target_reps, target_weight_kg=ex.target_weight_kg))
        _touch(session)
        try:
            db.commit()
        except IntegrityError:                             # two taps landed together: renumber from fresh data
            db.rollback()
            if attempt == 2:
                raise
            continue
        break
    return to_detail(_load(db, session_id))


def _find_set(session: WorkoutSession, set_id: int) -> WorkoutSessionSet:
    for e in session.exercises:
        for s in e.sets:
            if s.id == set_id:
                return s
    raise _not_found("Set")


def update_set(db: Session, session_id: int, set_id: int, data: SetUpdate) -> SessionDetail:
    session = _editable(db, session_id)
    row = _find_set(session, set_id)
    for field in data.model_fields_set:
        setattr(row, field, getattr(data, field))
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


def remove_set(db: Session, session_id: int, set_id: int) -> SessionDetail:
    session = _editable(db, session_id)
    row = _find_set(session, set_id)
    ex = row.exercise
    ex.sets.remove(row)
    db.flush()
    remaining = sorted(ex.sets, key=lambda s: s.set_number)
    for s in remaining:                                    # two phases: the (exercise, set_number) pair is unique
        s.set_number += RENUMBER_OFFSET                    # park above MAX_SETS so no number is ever used twice at once
    db.flush()
    for n, s in enumerate(remaining, start=1):
        s.set_number = n
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


# ---- cardio -------------------------------------------------------------------------------------------

def _get_cardio(session: WorkoutSession, cardio_id: int) -> WorkoutSessionCardio:
    for c in session.cardio:
        if c.id == cardio_id:
            return c
    raise _not_found("Cardio entry")


def add_cardio(db: Session, session_id: int, data: CardioAdd) -> SessionDetail:
    session = _editable(db, session_id)
    if len(session.cardio) >= MAX_CARDIO:
        raise AppError(409, f"A workout can have at most {MAX_CARDIO} cardio entries.", code="limit_reached")
    activity = db.get(CardioActivity, data.cardio_activity_id)
    if activity is None:
        raise AppError(404, "Cardio activity not found.", code="cardio_activity_not_found")
    session.cardio.append(WorkoutSessionCardio(
        cardio_activity_id=activity.id, position=max((c.position for c in session.cardio), default=0) + 1,
        status="pending", activity_name=activity.name))
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


def update_cardio(db: Session, session_id: int, cardio_id: int, data: CardioUpdate) -> SessionDetail:
    session = _editable(db, session_id)
    row = _get_cardio(session, cardio_id)
    for field in data.model_fields_set:
        setattr(row, field, getattr(data, field))
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


def remove_cardio(db: Session, session_id: int, cardio_id: int) -> SessionDetail:
    session = _editable(db, session_id)
    session.cardio.remove(_get_cardio(session, cardio_id))
    for n, c in enumerate(session.cardio, start=1):
        c.position = n
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


# ---- lifecycle ----------------------------------------------------------------------------------------

def complete_session(db: Session, session_id: int, data: CompleteInput) -> SessionDetail:
    session = _editable(db, session_id)
    session.status, session.ended_at, session.notes = COMPLETED, utc_now_naive(), data.notes
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


def cancel_session(db: Session, session_id: int, data: CancelInput) -> SessionDetail:
    session = _editable(db, session_id)
    session.status, session.ended_at, session.cancel_reason = CANCELLED, utc_now_naive(), data.reason
    _touch(session)
    _commit(db)
    return to_detail(_load(db, session_id))


# ---- listing / history ----------------------------------------------------------------------------------

def _aggregates(db: Session, ids: list[int]) -> dict[int, dict]:
    out = {i: dict(exercise_count=0, completed_exercise_count=0, completed_sets=0, cardio_minutes=0, names=[]) for i in ids}
    if not ids:
        return out
    for sid, name, status, position in db.execute(
            select(WorkoutSessionExercise.session_id, WorkoutSessionExercise.exercise_name, WorkoutSessionExercise.status,
                   WorkoutSessionExercise.position).where(WorkoutSessionExercise.session_id.in_(ids))
            .order_by(WorkoutSessionExercise.session_id, WorkoutSessionExercise.position)):
        out[sid]["exercise_count"] += 1
        out[sid]["completed_exercise_count"] += status == "completed"
        if len(out[sid]["names"]) < 4:
            out[sid]["names"].append(name)
    for sid, n in db.execute(
            select(WorkoutSessionExercise.session_id, func.count(WorkoutSessionSet.id))
            .join(WorkoutSessionSet, WorkoutSessionSet.session_exercise_id == WorkoutSessionExercise.id)
            .where(WorkoutSessionExercise.session_id.in_(ids), WorkoutSessionSet.status == "completed")
            .group_by(WorkoutSessionExercise.session_id)):
        out[sid]["completed_sets"] = n
    for sid, minutes in db.execute(
            select(WorkoutSessionCardio.session_id, func.coalesce(func.sum(WorkoutSessionCardio.duration_minutes), 0))
            .where(WorkoutSessionCardio.session_id.in_(ids), WorkoutSessionCardio.status == "completed")
            .group_by(WorkoutSessionCardio.session_id)):
        out[sid]["cardio_minutes"] = int(minutes)
    return out


def _item(s: WorkoutSession, agg: dict) -> SessionListItem:
    return SessionListItem(
        id=s.id, workout_date=s.workout_date, status=s.status, source=s.source, title=s.title, cycle_name=s.cycle_name,
        started_at=s.started_at, ended_at=s.ended_at, duration_seconds=duration_seconds(s),
        exercise_count=agg["exercise_count"], completed_exercise_count=agg["completed_exercise_count"],
        completed_sets=agg["completed_sets"], cardio_minutes=agg["cardio_minutes"], exercise_names=agg["names"])


def list_sessions(db: Session, status: str, start: date | None, end: date | None, exercise: str | None,
                  page: int, page_size: int) -> SessionList:
    if start and end and end < start:
        raise _invalid("end", "End date must be on or after the start date.")
    conditions = []
    if status == "finished":
        conditions.append(WorkoutSession.status.in_((COMPLETED, CANCELLED)))
    elif status != "all":
        conditions.append(WorkoutSession.status == status)
    if start:
        conditions.append(WorkoutSession.workout_date >= start)
    if end:
        conditions.append(WorkoutSession.workout_date <= end)
    if exercise:
        needle = exercise.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(exists().where(and_(
            WorkoutSessionExercise.session_id == WorkoutSession.id,
            func.lower(WorkoutSessionExercise.exercise_name).like(f"%{needle}%", escape="\\"))))
    total = db.scalar(select(func.count()).select_from(WorkoutSession).where(*conditions)) or 0
    rows = db.scalars(select(WorkoutSession).where(*conditions)
                      .order_by(WorkoutSession.workout_date.desc(), WorkoutSession.started_at.desc(), WorkoutSession.id.desc())
                      .limit(page_size).offset((page - 1) * page_size)).all()
    agg = _aggregates(db, [r.id for r in rows])
    return SessionList(items=[_item(r, agg[r.id]) for r in rows], total=total, page=page, page_size=page_size)


def recent_completed(db: Session, limit: int = 5) -> list[RecentSession]:
    rows = db.scalars(select(WorkoutSession).where(WorkoutSession.status == COMPLETED)
                      .order_by(WorkoutSession.ended_at.desc(), WorkoutSession.id.desc()).limit(limit)).all()
    agg = _aggregates(db, [r.id for r in rows])
    return [RecentSession(id=r.id, workout_date=r.workout_date, title=r.title, cycle_name=r.cycle_name, ended_at=r.ended_at,
                          duration_seconds=duration_seconds(r), completed_exercise_count=agg[r.id]["completed_exercise_count"],
                          completed_sets=agg[r.id]["completed_sets"], cardio_minutes=agg[r.id]["cardio_minutes"]) for r in rows]
