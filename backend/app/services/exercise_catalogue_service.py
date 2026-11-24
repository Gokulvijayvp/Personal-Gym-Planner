"""Built-in exercise catalogue: list it, and copy one entry into the user's Exercise Library."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.exercise_catalogue import BY_KEY, ENTRIES, CatalogueEntry, slug
from app.core.exercise_motion import MOTIONS, guess_motion
from app.models import CatalogueExercise, Exercise, MuscleGroup, TargetArea, WorkoutType
from app.schemas.common import ErrorDetail
from app.schemas.exercise import ExerciseInput, ExerciseRead
from app.schemas.exercise_catalogue import CatalogueCreate, CatalogueItem, CatalogueResponse
from app.services import catalogue_media_service, exercise_service


def _as_entry(c: CatalogueExercise) -> CatalogueEntry:
    return CatalogueEntry(c.key, c.name, c.muscle_group, c.target_area, c.equipment, c.icon_motion, c.movement)


def custom_entries(db: Session) -> list[CatalogueEntry]:
    return [_as_entry(c) for c in db.scalars(select(CatalogueExercise).order_by(CatalogueExercise.id))]


def all_entries(db: Session) -> list[CatalogueEntry]:
    """Built-in exercises plus the ones the admin added."""
    return [*ENTRIES, *custom_entries(db)]


def entries_by_key(db: Session) -> dict[str, CatalogueEntry]:
    return {e.key: e for e in all_entries(db)}


def find_entry(db: Session, key: str) -> CatalogueEntry | None:
    if key in BY_KEY:
        return BY_KEY[key]
    row = db.scalar(select(CatalogueExercise).where(CatalogueExercise.key == key))
    return _as_entry(row) if row else None


def list_catalogue(db: Session) -> CatalogueResponse:
    media = catalogue_media_service.media_by_key(db)
    owned = {name.lower(): ex_id for ex_id, name in db.execute(select(Exercise.id, Exercise.name))}
    entries = all_entries(db)
    items = [
        CatalogueItem(key=e.key, name=e.name, muscle_group=e.muscle_group, target_area=e.target_area,
                      equipment=e.equipment, icon_motion=e.icon_motion, movement=e.movement, custom=e.key not in BY_KEY,
                      in_library=e.name.lower() in owned, exercise_id=owned.get(e.name.lower()),
                      media=media.get(e.key, []))
        for e in entries
    ]
    present = {e.muscle_group for e in entries}
    order = [g for g in db.scalars(select(MuscleGroup.name).order_by(MuscleGroup.sort_order, MuscleGroup.id)) if g in present]
    return CatalogueResponse(items=items, muscle_groups=order, motions=MOTIONS)


def create_custom(db: Session, data: CatalogueCreate) -> CatalogueItem:
    """Admin only (enforced by the route). Adds a shared exercise; pictures/videos are uploaded to it afterwards."""
    group = db.scalar(select(MuscleGroup).where(MuscleGroup.name == data.muscle_group))
    if group is None:
        raise AppError(422, "Choose a muscle group from the list.", code="invalid_muscle_group")
    area = data.target_area or None
    if area is not None and db.scalar(select(TargetArea.id).where(TargetArea.muscle_group_id == group.id, TargetArea.name == area)) is None:
        raise AppError(422, f"'{area}' is not a target area of {group.name}.", code="invalid_target_area")
    key = slug(data.name)
    taken = {e.name.lower() for e in all_entries(db)} | set(entries_by_key(db))
    if not key or data.name.lower() in taken or key in taken:
        raise AppError(409, f"'{data.name}' is already in the catalogue.", code="duplicate_name",
                       details=[ErrorDetail(field="name", message="Already in the catalogue.", type="value_error")])
    movement = data.movement or None
    row = CatalogueExercise(key=key, name=data.name, muscle_group=group.name, target_area=area, equipment=data.equipment,
                            movement=movement, icon_motion=guess_motion(f"{data.name} {movement or ''}", group.name))
    db.add(row)
    db.commit()
    e = _as_entry(row)
    return CatalogueItem(key=e.key, name=e.name, muscle_group=e.muscle_group, target_area=e.target_area, equipment=e.equipment,
                         icon_motion=e.icon_motion, movement=e.movement, custom=True, in_library=False, media=[])


def add_to_library(db: Session, key: str) -> ExerciseRead:
    entry = find_entry(db, key)
    if entry is None:
        raise AppError(404, "That exercise is not in the catalogue.", code="catalogue_item_not_found")
    existing = db.scalar(select(Exercise.id).where(func.lower(Exercise.name) == entry.name.lower()))
    if existing is not None:
        raise AppError(409, f"'{entry.name}' is already in your library.", code="already_in_library",
                       details=[ErrorDetail(field="name", message="Already in your library.", type="value_error")])
    group = db.scalar(select(MuscleGroup).where(MuscleGroup.name == entry.muscle_group))
    if group is None:
        raise AppError(500, "Catalogue refers to a muscle group that is missing.", code="catalogue_misconfigured")
    area = db.scalar(select(TargetArea).where(TargetArea.muscle_group_id == group.id, TargetArea.name == entry.target_area)) \
        if entry.target_area else None
    equipment = db.scalar(select(WorkoutType).where(func.lower(WorkoutType.name) == entry.equipment.lower()))   # free text may not match a known type
    data = ExerciseInput(name=entry.name, muscle_group_id=group.id, target_area_id=area.id if area else None,
                         workout_type_id=equipment.id if equipment else None)
    return exercise_service.create_exercise(db, data, icon_motion=entry.icon_motion)
