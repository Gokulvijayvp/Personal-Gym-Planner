"""Share one day or one week of a workout plan with a code, and copy a shared one into your own plan.

A plan row points at the owner's own library exercise (an id), which means nothing to anyone else. So a share stores
NAMES (muscle group, exercise, equipment, cardio) plus sets/reps/rest/notes, and importing re-links each exercise to
the importer's own library by name, adding the exercise there if they do not have it yet.
"""
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import share_code
from app.core.errors import AppError
from app.core.timezone import utc_now_naive
from app.models import (
    CardioActivity, DailySchedule, Exercise, MuscleGroup, ScheduleCardio, ScheduleExercise, ScheduleMuscleGroup,
    TargetArea, WorkoutType,
)
from app.models.enums import ScheduleStatus
from app.models.plan_share import PlanShare
from app.schemas.exercise import ExerciseInput
from app.schemas.plan_share import (
    PlanImportResult, PlanShareCreated, PlanShareDay, PlanSharePreview,
)
from app.services import exercise_service
from app.services.cycle_service import assert_editable, get_cycle_or_404, transaction
from app.services.planner_service import DAY_NAMES, _find_day, _has_content, _week_days, _week_or_404

NOT_VALID = "That code isn't valid or has expired. Check it and try again."


# ---- making a share ---------------------------------------------------------------------------

def _day_snapshot(day: DailySchedule) -> dict:
    strength = []
    for group in day.muscle_groups:
        exercises = []
        for item in group.exercises:
            ex = item.exercise
            exercises.append({
                "name": ex.name,
                "muscle_group": ex.muscle_group.name if ex.muscle_group else group.muscle_group.name,
                "target_area": ex.target_area.name if ex.target_area else None,
                "equipment": ex.workout_type.name if ex.workout_type else None,
                "target_sets": item.target_sets, "target_reps": item.target_reps, "target_weight_kg": item.target_weight_kg,
                "rest_seconds": item.rest_seconds, "notes": item.notes,
            })
        strength.append({"muscle_group": group.muscle_group.name, "notes": group.notes, "exercises": exercises})
    cardio = [{"activity": c.cardio_activity.name, "duration_minutes": c.duration_minutes, "distance_km": c.distance_km, "notes": c.notes}
              for c in day.cardio_items]
    return {"status": day.status.value, "title": day.title, "notes": day.notes, "strength": strength, "cardio": cardio}


def _save(db: Session, kind: str, snapshot: dict) -> PlanShareCreated:
    for _ in range(5):
        code = share_code.new_code()
        if db.scalar(select(PlanShare.id).where(PlanShare.code == code)) is None:
            break
    row = PlanShare(code=code, kind=kind, owner_id=db.info.get("user_id"), snapshot=snapshot,
                    expires_at=utc_now_naive() + timedelta(days=share_code.SHARE_DAYS))
    db.add(row)
    db.commit()
    days = len(snapshot["days"]) if kind == "week" else 1
    return PlanShareCreated(code=share_code.pretty(code), kind=kind, days_count=days, expires_at=row.expires_at)


def share_day(db: Session, cycle_id: int, week_number: int, day_of_week: int) -> PlanShareCreated:
    cycle = get_cycle_or_404(db, cycle_id)
    week = _week_or_404(db, cycle, week_number)
    day = _find_day(db, week.id, day_of_week)
    if not _has_content(day):
        raise AppError(400, f"{DAY_NAMES[day_of_week]} has nothing planned to share.", code="nothing_to_share")
    return _save(db, "day", {"day": _day_snapshot(day)})


def share_week(db: Session, cycle_id: int, week_number: int) -> PlanShareCreated:
    cycle = get_cycle_or_404(db, cycle_id)
    week = _week_or_404(db, cycle, week_number)
    days = {str(dow): _day_snapshot(d) for dow, d in _week_days(db, week.id).items() if _has_content(d)}
    if not days:
        raise AppError(400, "This week has nothing planned to share.", code="nothing_to_share")
    return _save(db, "week", {"days": days})


# ---- reading a share --------------------------------------------------------------------------

def _find(db: Session, code: str) -> PlanShare:
    row = db.scalar(select(PlanShare).where(PlanShare.code == share_code.normalise(code)))
    if row is None or row.expires_at <= utc_now_naive():
        raise AppError(404, NOT_VALID, code="share_code_invalid")           # the same answer for "wrong" and "expired"
    return row


def _snapshot_days(row: PlanShare) -> dict[int, dict]:
    """The days in a share, by weekday number (a day share has one entry under -1: it goes wherever the importer chooses)."""
    return {int(k): v for k, v in row.snapshot["days"].items()} if row.kind == "week" else {-1: row.snapshot["day"]}


def _exercise_specs(days: dict[int, dict]) -> dict[str, dict]:
    """Each distinct exercise in the share (by lower-cased name), with its details."""
    out: dict[str, dict] = {}
    for d in days.values():
        for g in d["strength"]:
            for e in g["exercises"]:
                out.setdefault(e["name"].lower(), e)
    return out


def _library_names(db: Session) -> set[str]:
    return {n.lower() for n in db.scalars(select(Exercise.name))}


def preview(db: Session, code: str) -> PlanSharePreview:
    row = _find(db, code)
    days = _snapshot_days(row)
    have = _library_names(db)
    missing = sorted((s["name"] for k, s in _exercise_specs(days).items() if k not in have), key=str.lower)
    out = []
    for dow, d in sorted(days.items()):
        out.append(PlanShareDay(
            day_of_week=dow, name=DAY_NAMES[dow] if dow >= 0 else "This day", status=d["status"], title=d.get("title"),
            muscle_groups=[g["muscle_group"] for g in d["strength"]],
            exercise_count=sum(len(g["exercises"]) for g in d["strength"]), cardio_count=len(d["cardio"])))
    return PlanSharePreview(kind=row.kind, days=out, new_exercises=missing, expires_at=row.expires_at)


# ---- copying a share into your plan -----------------------------------------------------------

def _resolve_exercises(db: Session, specs: dict[str, dict]) -> tuple[dict[str, int], list[str]]:
    """Your library exercise for each shared one (matched by name); adds the ones you do not have yet."""
    mine = {e.name.lower(): e for e in db.scalars(select(Exercise))}
    groups = {g.name: g for g in db.scalars(select(MuscleGroup))}
    ids: dict[str, int] = {}
    added: list[str] = []
    for key, spec in specs.items():
        existing = mine.get(key)
        if existing is not None:
            ids[key] = existing.id
            continue
        group = groups.get(spec["muscle_group"])
        if group is None:
            raise AppError(422, f"'{spec['name']}' uses a muscle group this app doesn't have.", code="unknown_muscle_group")
        area = db.scalar(select(TargetArea).where(TargetArea.muscle_group_id == group.id, TargetArea.name == spec["target_area"])) \
            if spec.get("target_area") else None
        equipment = db.scalar(select(WorkoutType).where(func.lower(WorkoutType.name) == (spec.get("equipment") or "").lower())) \
            if spec.get("equipment") else None
        created = exercise_service.create_exercise(
            db, ExerciseInput(name=spec["name"], muscle_group_id=group.id, target_area_id=area.id if area else None,
                              workout_type_id=equipment.id if equipment else None))
        ids[key] = created.id
        added.append(spec["name"])
    return ids, added


def _build_day(db: Session, week_id: int, dow: int, snap: dict, ex_ids: dict[str, int],
               groups: dict[str, MuscleGroup], cardio: dict[str, CardioActivity]) -> DailySchedule:
    day = DailySchedule(weekly_plan_id=week_id, day_of_week=dow,
                        status=ScheduleStatus.rest if snap["status"] == "rest" else ScheduleStatus.planned,
                        title=snap.get("title"), notes=snap.get("notes"))
    for g in snap["strength"]:
        group = groups.get(g["muscle_group"])
        if group is None:
            continue
        node = ScheduleMuscleGroup(muscle_group_id=group.id, notes=g.get("notes"))
        for order, e in enumerate(g["exercises"], start=1):
            node.exercises.append(ScheduleExercise(
                exercise_id=ex_ids[e["name"].lower()], exercise_order=order, target_sets=e["target_sets"],
                target_reps=e["target_reps"], target_weight_kg=e.get("target_weight_kg"), rest_seconds=e.get("rest_seconds"),
                notes=e.get("notes")))
        day.muscle_groups.append(node)
    for i, c in enumerate(snap["cardio"]):
        activity = cardio.get(c["activity"])
        if activity is not None:
            day.cardio_items.append(ScheduleCardio(cardio_activity_id=activity.id, duration_minutes=c["duration_minutes"],
                                                   distance_km=c.get("distance_km"), notes=c.get("notes"), sort_order=i))
    db.add(day)
    return day


def import_share(db: Session, code: str, cycle_id: int, week_number: int, day_of_week: int | None, confirm_replace: bool) -> PlanImportResult:
    row = _find(db, code)
    days = _snapshot_days(row)
    cycle = get_cycle_or_404(db, cycle_id)
    assert_editable(cycle)
    week = _week_or_404(db, cycle, week_number)
    if row.kind == "day":
        if day_of_week is None:
            raise AppError(422, "Choose which day to put this plan on.", code="day_required")
        targets = {day_of_week: days[-1]}
    else:
        targets = days
    existing = _week_days(db, week.id)
    # a week code replaces the whole week; a day code replaces only that weekday
    doomed = {d: day for d, day in existing.items() if (row.kind == "week" or d == day_of_week)}
    busy = [d for d, day in doomed.items() if _has_content(day)]
    if busy and not confirm_replace:
        where = "this week" if row.kind == "week" else DAY_NAMES[day_of_week]
        raise AppError(409, f"{where.capitalize()} already has a plan. Confirm to replace it.", code="target_not_empty")

    specs = _exercise_specs(days)
    groups = {g.name: g for g in db.scalars(select(MuscleGroup))}
    cardio = {c.name: c for c in db.scalars(select(CardioActivity))}
    with transaction(db):
        ex_ids, added = _resolve_exercises(db, specs)           # (each new exercise is saved as it is created)
        for day in doomed.values():
            db.delete(day)
        db.flush()                                              # free the (week, weekday) unique key before inserting
        for dow, snap in targets.items():
            _build_day(db, week.id, dow, snap, ex_ids, groups, cardio)
    return PlanImportResult(kind=row.kind, replaced_days=len(busy), imported_days=len(targets), added_exercises=added)
