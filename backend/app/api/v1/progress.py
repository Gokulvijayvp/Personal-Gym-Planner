from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.progress import (
    Cardio, Consistency, ExerciseOptions, ExerciseProgress, MuscleGroups, Overview, PersonalRecords, Volume,
)
from app.services import progress_service as service

router = APIRouter(prefix="/progress", tags=["Progress"])

START = Query(None, description="First date (YYYY-MM-DD, Asia/Kolkata). Omit for all time.")
END = Query(None, description="Last date. Omit for today; a future date is treated as today.")


@router.get("/overview", response_model=Overview)
def overview(start: date | None = START, end: date | None = END, db: Session = Depends(get_db)):
    """Counts from completed workouts only. Read-only."""
    return service.overview(db, start, end)


@router.get("/consistency", response_model=Consistency)
def consistency(start: date | None = START, end: date | None = END, db: Session = Depends(get_db)):
    return service.consistency(db, start, end)


@router.get("/exercises", response_model=ExerciseOptions)
def exercises(start: date | None = START, end: date | None = END, db: Session = Depends(get_db)):
    """Exercises with completed sets in the range (feeds the selector)."""
    return service.exercise_options(db, start, end)


@router.get("/exercise", response_model=ExerciseProgress)
def exercise(key: str = Query(..., max_length=200, description="'id:<exercise id>' or 'name:<name>'"),
             start: date | None = START, end: date | None = END, db: Session = Depends(get_db)):
    return service.exercise_progress(db, key, start, end)


@router.get("/volume", response_model=Volume)
def volume(start: date | None = START, end: date | None = END, db: Session = Depends(get_db)):
    return service.volume(db, start, end)


@router.get("/personal-records", response_model=PersonalRecords)
def personal_records(start: date | None = START, end: date | None = END, db: Session = Depends(get_db)):
    return service.personal_records(db, start, end)


@router.get("/muscle-groups", response_model=MuscleGroups)
def muscle_groups(start: date | None = START, end: date | None = END, db: Session = Depends(get_db)):
    return service.muscle_groups(db, start, end)


@router.get("/cardio", response_model=Cardio)
def cardio(start: date | None = START, end: date | None = END,
           activity: str | None = Query(None, max_length=80, description="Activity name for the distance series"),
           db: Session = Depends(get_db)):
    return service.cardio(db, start, end, (activity or "").strip() or None)
