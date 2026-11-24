from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.exercise import (
    ExerciseCreate, ExerciseListResponse, ExerciseRead, ExerciseSort, ExerciseStatusUpdate,
    ExerciseUpdate, SortOrder,
)
from app.services import exercise_service as service
from app.services.exercise_service import ExerciseFilters

router = APIRouter(prefix="/exercises", tags=["Exercises"])


@router.get("", response_model=ExerciseListResponse)
def list_exercises(
    search: str | None = Query(None, max_length=100, description="Case-insensitive match on exercise name"),
    muscle_group_id: int | None = Query(None, gt=0, description="Primary muscle group"),
    target_area_id: int | None = Query(None, gt=0),
    workout_type_id: int | None = Query(None, gt=0),
    is_active: bool | None = Query(None),
    sort: ExerciseSort = "name",
    order: SortOrder = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ExerciseListResponse:
    filters = ExerciseFilters(
        search=(search or "").strip() or None, muscle_group_id=muscle_group_id,
        target_area_id=target_area_id, workout_type_id=workout_type_id, is_active=is_active,
    )
    return service.list_exercises(db, filters, sort, order, page, page_size)


@router.post("", response_model=ExerciseRead, status_code=status.HTTP_201_CREATED)
def create_exercise(payload: ExerciseCreate, response: Response, db: Session = Depends(get_db)) -> ExerciseRead:
    created = service.create_exercise(db, payload)
    response.headers["Location"] = f"/api/v1/exercises/{created.id}"
    return created


@router.get("/{exercise_id}", response_model=ExerciseRead)
def get_exercise(exercise_id: int, db: Session = Depends(get_db)) -> ExerciseRead:
    return service.get_exercise(db, exercise_id)


@router.put("/{exercise_id}", response_model=ExerciseRead)
def update_exercise(exercise_id: int, payload: ExerciseUpdate, db: Session = Depends(get_db)) -> ExerciseRead:
    return service.update_exercise(db, exercise_id, payload)


@router.patch("/{exercise_id}/status", response_model=ExerciseRead)
def set_exercise_status(exercise_id: int, payload: ExerciseStatusUpdate,
                        db: Session = Depends(get_db)) -> ExerciseRead:
    """Activate / deactivate. Deactivating is the safe alternative to deleting a used exercise."""
    return service.set_exercise_active(db, exercise_id, payload.is_active)


@router.delete("/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(exercise_id: int, db: Session = Depends(get_db)) -> Response:
    service.delete_exercise(db, exercise_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
