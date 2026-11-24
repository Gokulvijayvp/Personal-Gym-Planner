"""Edit/remove single plan rows by id (they know which day/week/cycle they belong to)."""
from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.planner import CardioInput, DayDetail, ExerciseAssignment
from app.services import planner_service as planner

router = APIRouter(tags=["Weekly planner"])


@router.put("/schedule-exercises/{item_id}", response_model=DayDetail)
def update_planned_exercise(payload: ExerciseAssignment, item_id: int = Path(gt=0),
                            db: Session = Depends(get_db)) -> DayDetail:
    """Change sets / reps / weight / rest / notes (or swap the library exercise)."""
    return planner.update_exercise(db, item_id, payload)


@router.delete("/schedule-exercises/{item_id}", response_model=DayDetail)
def remove_planned_exercise(item_id: int = Path(gt=0), db: Session = Depends(get_db)) -> DayDetail:
    """Remove from the plan only; the library exercise is untouched. Remaining orders are renumbered."""
    return planner.remove_exercise(db, item_id)


@router.put("/schedule-cardio/{item_id}", response_model=DayDetail)
def update_planned_cardio(payload: CardioInput, item_id: int = Path(gt=0), db: Session = Depends(get_db)) -> DayDetail:
    return planner.update_cardio(db, item_id, payload)


@router.delete("/schedule-cardio/{item_id}", response_model=DayDetail)
def remove_planned_cardio(item_id: int = Path(gt=0), db: Session = Depends(get_db)) -> DayDetail:
    return planner.remove_cardio(db, item_id)
