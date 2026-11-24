"""Exercise library business logic. Routers stay thin; all rules live here."""
import math
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.errors import AppError
from app.models import (
    Exercise, MuscleGroup, ScheduleExercise, TargetArea, WorkoutSessionExercise, WorkoutType,
)
from app.schemas.common import ErrorDetail
from app.services import exercise_master_service
from app.schemas.exercise import (
    ExerciseInput, ExerciseListResponse, ExerciseRead, ExerciseSort, SortOrder,
)


@dataclass
class ExerciseFilters:
    search: str | None = None
    muscle_group_id: int | None = None   # primary muscle group
    target_area_id: int | None = None
    workout_type_id: int | None = None
    is_active: bool | None = None


# ---- helpers -----------------------------------------------------------------------------

def _field_error(field: str, message: str) -> ErrorDetail:
    return ErrorDetail(field=field, message=message, type="value_error")


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _load_options():
    return (
        joinedload(Exercise.muscle_group),
        joinedload(Exercise.target_area),
        joinedload(Exercise.workout_type),
        joinedload(Exercise.exercise_master),
        selectinload(Exercise.secondary_muscle_groups),
    )


def usage_counts(db: Session, exercise_ids: list[int]) -> dict[int, int]:
    """How many schedule rows + logged workout exercises reference each exercise."""
    if not exercise_ids:
        return {}
    counts: dict[int, int] = {i: 0 for i in exercise_ids}
    for model in (ScheduleExercise, WorkoutSessionExercise):
        rows = db.execute(
            select(model.exercise_id, func.count()).where(model.exercise_id.in_(exercise_ids))
            .group_by(model.exercise_id)
        ).all()
        for exercise_id, n in rows:
            counts[exercise_id] += n
    return counts


def to_read(db: Session, exercises: list[Exercise]) -> list[ExerciseRead]:
    counts = usage_counts(db, [e.id for e in exercises])
    return [ExerciseRead.model_validate(e).model_copy(update={"usage_count": counts[e.id]}) for e in exercises]


def _get_or_404(db: Session, exercise_id: int) -> Exercise:
    exercise = db.execute(
        select(Exercise).options(*_load_options()).where(Exercise.id == exercise_id)
    ).unique().scalar_one_or_none()
    if exercise is None:
        raise AppError(404, "Exercise not found.", code="exercise_not_found")
    return exercise


def _assert_name_free(db: Session, name: str, exclude_id: int | None = None) -> None:
    # Both sides go through SQLite's lower() so this matches the unique index exactly.
    stmt = select(Exercise.id).where(func.lower(Exercise.name) == func.lower(name))
    if exclude_id is not None:
        stmt = stmt.where(Exercise.id != exclude_id)
    if db.execute(stmt).first() is not None:
        raise AppError(409, f"An exercise named '{name}' already exists.", code="duplicate_name",
                       details=[_field_error("name", "An exercise with this name already exists.")])


def _resolve_references(db: Session, data: ExerciseInput):
    """Validate every foreign reference; report all problems at once, per field."""
    errors: list[ErrorDetail] = []

    primary = db.get(MuscleGroup, data.muscle_group_id)
    if primary is None:
        errors.append(_field_error("muscle_group_id", "Muscle group does not exist."))

    secondary: list[MuscleGroup] = []
    if data.secondary_muscle_group_ids:
        found = {
            g.id: g for g in db.scalars(select(MuscleGroup).where(MuscleGroup.id.in_(data.secondary_muscle_group_ids)))
        }
        missing = [i for i in data.secondary_muscle_group_ids if i not in found]
        if missing:
            errors.append(_field_error("secondary_muscle_group_ids", f"Unknown muscle group id(s): {missing}."))
        if data.muscle_group_id in data.secondary_muscle_group_ids:
            errors.append(_field_error("secondary_muscle_group_ids",
                                       "Secondary muscles cannot include the primary muscle group."))
        secondary = [found[i] for i in data.secondary_muscle_group_ids if i in found and i != data.muscle_group_id]

    target_area: TargetArea | None = None
    if data.target_area_id is not None:
        target_area = db.get(TargetArea, data.target_area_id)
        if target_area is None:
            errors.append(_field_error("target_area_id", "Target area does not exist."))
        elif primary is not None and target_area.muscle_group_id != primary.id:
            errors.append(_field_error(
                "target_area_id", f"'{target_area.name}' is not a target area of {primary.name}."))

    workout_type: WorkoutType | None = None
    if data.workout_type_id is not None:
        workout_type = db.get(WorkoutType, data.workout_type_id)
        if workout_type is None:
            errors.append(_field_error("workout_type_id", "Workout type does not exist."))

    if errors:
        raise AppError(422, "Some of the submitted values are invalid.", code="validation_error", details=errors)
    return primary, secondary, target_area, workout_type


def _apply(db: Session, exercise: Exercise, data: ExerciseInput, primary, secondary, target_area, workout_type,
           icon_motion: str | None = None) -> None:
    exercise.name = data.name
    exercise.description = data.description
    exercise.muscle_group = primary
    # Same order the relationship uses when loading, so a response never differs from a later GET.
    exercise.secondary_muscle_groups = sorted(secondary, key=lambda g: (g.sort_order, g.id))
    exercise.target_area = target_area
    exercise.workout_type = workout_type
    exercise.instructions = data.instructions
    exercise.media_url = data.media_url
    exercise.is_active = data.is_active
    exercise.exercise_master = exercise_master_service.link_for_exercise(
        db, data.name, primary.name if primary else None, icon_motion)


def _commit_or_conflict(db: Session, name: str, exclude_id: int | None) -> None:
    """Commit; a concurrent duplicate that slipped past the pre-check hits the unique index."""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _assert_name_free(db, name, exclude_id)  # raises the friendly duplicate_name error
        raise


# ---- public API --------------------------------------------------------------------------

def list_exercises(db: Session, filters: ExerciseFilters, sort: ExerciseSort, order: SortOrder,
                   page: int, page_size: int) -> ExerciseListResponse:
    conditions = []
    if filters.search:
        conditions.append(Exercise.name.ilike(f"%{_escape_like(filters.search)}%", escape="\\"))
    if filters.muscle_group_id is not None:
        conditions.append(Exercise.muscle_group_id == filters.muscle_group_id)
    if filters.target_area_id is not None:
        conditions.append(Exercise.target_area_id == filters.target_area_id)
    if filters.workout_type_id is not None:
        conditions.append(Exercise.workout_type_id == filters.workout_type_id)
    if filters.is_active is not None:
        conditions.append(Exercise.is_active == filters.is_active)

    total = db.scalar(select(func.count()).select_from(Exercise).where(*conditions)) or 0
    total_all = db.scalar(select(func.count()).select_from(Exercise)) or 0

    sort_column = {"name": func.lower(Exercise.name), "created_at": Exercise.created_at,
                   "updated_at": Exercise.updated_at}[sort]
    ordering = sort_column.desc() if order == "desc" else sort_column.asc()
    items = db.execute(
        select(Exercise).options(*_load_options()).where(*conditions)
        .order_by(ordering, Exercise.id.asc())   # id tiebreak keeps pagination stable
        .limit(page_size).offset((page - 1) * page_size)
    ).unique().scalars().all()

    return ExerciseListResponse(
        items=to_read(db, list(items)), total=total, total_all=total_all, page=page, page_size=page_size,
        pages=max(1, math.ceil(total / page_size)),
    )


def get_exercise(db: Session, exercise_id: int) -> ExerciseRead:
    return to_read(db, [_get_or_404(db, exercise_id)])[0]


def create_exercise(db: Session, data: ExerciseInput, icon_motion: str | None = None) -> ExerciseRead:
    _assert_name_free(db, data.name)
    refs = _resolve_references(db, data)
    exercise = Exercise()
    _apply(db, exercise, data, *refs, icon_motion=icon_motion)
    db.add(exercise)
    _commit_or_conflict(db, data.name, None)
    return get_exercise(db, exercise.id)


def update_exercise(db: Session, exercise_id: int, data: ExerciseInput) -> ExerciseRead:
    exercise = _get_or_404(db, exercise_id)
    _assert_name_free(db, data.name, exclude_id=exercise_id)
    refs = _resolve_references(db, data)
    _apply(db, exercise, data, *refs)
    _commit_or_conflict(db, data.name, exercise_id)
    return get_exercise(db, exercise_id)


def set_exercise_active(db: Session, exercise_id: int, is_active: bool) -> ExerciseRead:
    exercise = _get_or_404(db, exercise_id)
    exercise.is_active = is_active
    db.commit()
    return get_exercise(db, exercise_id)


def delete_exercise(db: Session, exercise_id: int) -> None:
    exercise = _get_or_404(db, exercise_id)
    used = usage_counts(db, [exercise_id])[exercise_id]
    if used:
        raise AppError(
            409,
            f"'{exercise.name}' is used in {used} planned or logged record(s) and can't be deleted. "
            "Deactivate it instead to keep your history and hide it from new plans.",
            code="exercise_in_use",
        )
    db.delete(exercise)
    db.commit()
