"""Exercise master list: the names Library exercises are picked from, each with an icon motion."""
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.exercise_motion import MOTIONS, guess_motion
from app.models import Exercise, ExerciseMaster
from app.schemas.common import ErrorDetail
from app.schemas.exercise_master import ExerciseMasterInput, ExerciseMasterListResponse, ExerciseMasterRead


def _dup(name: str, message: str | None = None) -> AppError:
    return AppError(409, message or f"An exercise master named '{name}' already exists.", code="duplicate_name",
                    details=[ErrorDetail(field="name", message="This name already exists.", type="value_error")])


def find_by_name(db: Session, name: str) -> ExerciseMaster | None:
    return db.scalars(select(ExerciseMaster).where(func.lower(ExerciseMaster.name) == func.lower(name))).first()


def _get_or_404(db: Session, master_id: int) -> ExerciseMaster:
    master = db.get(ExerciseMaster, master_id)
    if master is None:
        raise AppError(404, "Exercise master not found.", code="exercise_master_not_found")
    return master


def _to_read(db: Session, masters: list[ExerciseMaster]) -> list[ExerciseMasterRead]:
    counts = dict(db.execute(
        select(Exercise.exercise_master_id, func.count()).where(Exercise.exercise_master_id.is_not(None))
        .group_by(Exercise.exercise_master_id)
    ).all())
    return [ExerciseMasterRead.model_validate(m).model_copy(update={"usage_count": counts.get(m.id, 0)}) for m in masters]


def link_for_exercise(db: Session, name: str, muscle_group_name: str | None,
                      icon_motion: str | None = None) -> ExerciseMaster:
    """The master for a library exercise name: the existing one (any letter case) or a newly created one."""
    master = find_by_name(db, name)
    if master is None:
        master = ExerciseMaster(name=name, icon_motion=icon_motion or guess_motion(name, muscle_group_name), is_active=True)
        db.add(master)
    return master


def list_masters(db: Session) -> ExerciseMasterListResponse:
    masters = db.scalars(select(ExerciseMaster).order_by(func.lower(ExerciseMaster.name), ExerciseMaster.id)).all()
    return ExerciseMasterListResponse(items=_to_read(db, list(masters)), motions=MOTIONS)


def create_master(db: Session, data: ExerciseMasterInput) -> ExerciseMasterRead:
    if find_by_name(db, data.name) is not None:
        raise _dup(data.name)
    master = ExerciseMaster(name=data.name, icon_motion=data.icon_motion or guess_motion(data.name), is_active=True)
    db.add(master)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _dup(data.name)
    return _to_read(db, [master])[0]


def update_master(db: Session, master_id: int, data: ExerciseMasterInput) -> ExerciseMasterRead:
    """Rename and/or change icon. Linked library exercises are renamed too, so the two never drift apart."""
    master = _get_or_404(db, master_id)
    other = find_by_name(db, data.name)
    if other is not None and other.id != master.id:
        raise _dup(data.name)
    if data.name != master.name:
        clash = db.scalars(
            select(Exercise).where(func.lower(Exercise.name) == func.lower(data.name),
                                   Exercise.exercise_master_id.is_distinct_from(master.id))
        ).first()
        if clash is not None:
            raise _dup(data.name, f"A library exercise named '{data.name}' already exists.")
        for exercise in db.scalars(select(Exercise).where(Exercise.exercise_master_id == master.id)):
            exercise.name = data.name
    master.name = data.name
    if data.icon_motion is not None:
        master.icon_motion = data.icon_motion
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _dup(data.name)
    return _to_read(db, [master])[0]


def delete_master(db: Session, master_id: int) -> None:
    master = _get_or_404(db, master_id)
    used = db.scalar(select(func.count()).select_from(Exercise).where(Exercise.exercise_master_id == master.id)) or 0
    if used:
        raise AppError(
            409, f"'{master.name}' is used by {used} library exercise(s). Remove or rename those first.",
            code="exercise_master_in_use")
    db.delete(master)
    db.commit()
