"""Read-only reference data used by forms and filters (seeded by migrations)."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models import CardioActivity, MuscleGroup, WorkoutType
from app.schemas.master_data import CardioActivityRead, MuscleGroupRead, WorkoutTypeRead

router = APIRouter(tags=["Master data"])


@router.get("/muscle-groups", response_model=list[MuscleGroupRead])
def list_muscle_groups(db: Session = Depends(get_db)) -> list[MuscleGroup]:
    """Muscle groups in display order, each with its own target areas."""
    return list(db.scalars(
        select(MuscleGroup).options(selectinload(MuscleGroup.target_areas)).order_by(MuscleGroup.sort_order, MuscleGroup.id)
    ))


@router.get("/workout-types", response_model=list[WorkoutTypeRead])
def list_workout_types(db: Session = Depends(get_db)) -> list[WorkoutType]:
    return list(db.scalars(select(WorkoutType).order_by(WorkoutType.id)))


@router.get("/cardio-activities", response_model=list[CardioActivityRead])
def list_cardio_activities(db: Session = Depends(get_db)) -> list[CardioActivity]:
    """Kinds of planned cardio. Cardio is its own category, not a muscle group."""
    return list(db.scalars(select(CardioActivity).order_by(CardioActivity.sort_order, CardioActivity.id)))
