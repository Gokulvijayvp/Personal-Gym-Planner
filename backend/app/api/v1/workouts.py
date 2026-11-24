from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.workout_log import (
    CardioAdd, CardioUpdate, CancelInput, CompleteInput, ExerciseAdd, ExerciseUpdate, ReorderInput, SessionDetail,
    SessionList, SessionRef, SetUpdate, StartInput,
)
from app.services import workout_service as service

router = APIRouter(prefix="/workouts", tags=["Workout logging"])


@router.post("", response_model=SessionDetail, status_code=status.HTTP_201_CREATED)
def start_workout(payload: StartInput, response: Response, db: Session = Depends(get_db)) -> SessionDetail:
    """Start from a planned day or a blank workout. Repeating a start returns the unfinished session (200)."""
    detail, created = service.start_session(db, payload)
    response.headers["Location"] = f"/api/v1/workouts/{detail.id}"
    if not created:
        response.status_code = status.HTTP_200_OK
    return detail


@router.get("", response_model=SessionList)
def list_workouts(
    status: Literal["all", "finished", "in_progress", "completed", "cancelled"] = "all",
    start: date | None = Query(None, description="Earliest workout date"),
    end: date | None = Query(None, description="Latest workout date"),
    exercise: str | None = Query(None, max_length=100, description="Sessions that include an exercise whose name contains this"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> SessionList:
    return service.list_sessions(db, status, start, end, (exercise or "").strip() or None, page, page_size)


@router.get("/current", response_model=SessionRef | None)
def current_workout(db: Session = Depends(get_db)) -> SessionRef | None:
    """The unfinished workout to resume, or null."""
    s = service.current_session(db)
    return None if s is None else SessionRef(id=s.id, status=s.status, workout_date=s.workout_date, title=s.title)


@router.get("/{session_id}", response_model=SessionDetail)
def get_workout(session_id: int, db: Session = Depends(get_db)) -> SessionDetail:
    return service.get_session(db, session_id)


@router.post("/{session_id}/complete", response_model=SessionDetail)
def complete_workout(session_id: int, payload: CompleteInput, db: Session = Depends(get_db)) -> SessionDetail:
    return service.complete_session(db, session_id, payload)


@router.post("/{session_id}/cancel", response_model=SessionDetail)
def cancel_workout(session_id: int, payload: CancelInput, db: Session = Depends(get_db)) -> SessionDetail:
    return service.cancel_session(db, session_id, payload)


# ---- exercises -------------------------------------------------------------------------------
@router.post("/{session_id}/exercises", response_model=SessionDetail, status_code=status.HTTP_201_CREATED)
def add_exercise(session_id: int, payload: ExerciseAdd, db: Session = Depends(get_db)) -> SessionDetail:
    return service.add_exercise(db, session_id, payload)


@router.put("/{session_id}/exercises/order", response_model=SessionDetail)
def reorder_exercises(session_id: int, payload: ReorderInput, db: Session = Depends(get_db)) -> SessionDetail:
    return service.reorder_exercises(db, session_id, payload)


@router.patch("/{session_id}/exercises/{exercise_id}", response_model=SessionDetail)
def update_exercise(session_id: int, exercise_id: int, payload: ExerciseUpdate, db: Session = Depends(get_db)) -> SessionDetail:
    return service.update_exercise(db, session_id, exercise_id, payload)


@router.delete("/{session_id}/exercises/{exercise_id}", response_model=SessionDetail)
def remove_exercise(session_id: int, exercise_id: int, db: Session = Depends(get_db)) -> SessionDetail:
    return service.remove_exercise(db, session_id, exercise_id)


# ---- sets -------------------------------------------------------------------------------------
@router.post("/{session_id}/exercises/{exercise_id}/sets", response_model=SessionDetail, status_code=status.HTTP_201_CREATED)
def add_set(session_id: int, exercise_id: int, db: Session = Depends(get_db)) -> SessionDetail:
    return service.add_set(db, session_id, exercise_id)


@router.patch("/{session_id}/sets/{set_id}", response_model=SessionDetail)
def update_set(session_id: int, set_id: int, payload: SetUpdate, db: Session = Depends(get_db)) -> SessionDetail:
    return service.update_set(db, session_id, set_id, payload)


@router.delete("/{session_id}/sets/{set_id}", response_model=SessionDetail)
def remove_set(session_id: int, set_id: int, db: Session = Depends(get_db)) -> SessionDetail:
    return service.remove_set(db, session_id, set_id)


# ---- cardio -----------------------------------------------------------------------------------
@router.post("/{session_id}/cardio", response_model=SessionDetail, status_code=status.HTTP_201_CREATED)
def add_cardio(session_id: int, payload: CardioAdd, db: Session = Depends(get_db)) -> SessionDetail:
    return service.add_cardio(db, session_id, payload)


@router.patch("/{session_id}/cardio/{cardio_id}", response_model=SessionDetail)
def update_cardio(session_id: int, cardio_id: int, payload: CardioUpdate, db: Session = Depends(get_db)) -> SessionDetail:
    return service.update_cardio(db, session_id, cardio_id, payload)


@router.delete("/{session_id}/cardio/{cardio_id}", response_model=SessionDetail)
def remove_cardio(session_id: int, cardio_id: int, db: Session = Depends(get_db)) -> SessionDetail:
    return service.remove_cardio(db, session_id, cardio_id)
