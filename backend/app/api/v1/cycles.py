from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.enums import CycleStatus
from app.schemas.cycle import CycleDetail, CycleInput, CycleSummary
from app.schemas.planner import (
    CardioInput, CopyResult, DayCopy, DayDetail, DayUpsert, ExerciseAssignment, ExerciseOrder,
    MuscleGroupAssign, WeekCopy, WeekDetail,
)
from app.services import cycle_service as cycles
from app.services import planner_service as planner

router = APIRouter(prefix="/cycles", tags=["Workout cycles"])

CycleId = Path(gt=0)
WeekNo = Path(ge=1, le=52, description="1-based week number within the cycle")
Dow = Path(ge=0, le=6, description="Monday=0 .. Sunday=6")
GroupId = Path(gt=0, description="Muscle group id")


# ---- cycles -------------------------------------------------------------------------------

@router.get("", response_model=list[CycleSummary])
def list_cycles(status_filter: CycleStatus | None = Query(None, alias="status"),
                db: Session = Depends(get_db)) -> list[CycleSummary]:
    return cycles.list_cycles(db, status_filter)


@router.post("", response_model=CycleDetail, status_code=status.HTTP_201_CREATED)
def create_cycle(payload: CycleInput, response: Response, db: Session = Depends(get_db)) -> CycleDetail:
    """Creates the cycle as a draft and generates Week 1..N."""
    created = cycles.create_cycle(db, payload)
    response.headers["Location"] = f"/api/v1/cycles/{created.id}"
    return created


@router.get("/{cycle_id}", response_model=CycleDetail)
def get_cycle(cycle_id: int = CycleId, db: Session = Depends(get_db)) -> CycleDetail:
    return cycles.get_cycle(db, cycle_id)


@router.put("/{cycle_id}", response_model=CycleDetail)
def update_cycle(payload: CycleInput, cycle_id: int = CycleId, db: Session = Depends(get_db)) -> CycleDetail:
    return cycles.update_cycle(db, cycle_id, payload)


@router.delete("/{cycle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cycle(cycle_id: int = CycleId, db: Session = Depends(get_db)) -> Response:
    cycles.delete_cycle(db, cycle_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{cycle_id}/activate", response_model=CycleDetail)
def activate_cycle(cycle_id: int = CycleId, db: Session = Depends(get_db)) -> CycleDetail:
    return cycles.activate_cycle(db, cycle_id)


@router.post("/{cycle_id}/complete", response_model=CycleDetail)
def complete_cycle(cycle_id: int = CycleId, db: Session = Depends(get_db)) -> CycleDetail:
    return cycles.complete_cycle(db, cycle_id)


@router.post("/{cycle_id}/archive", response_model=CycleDetail)
def archive_cycle(cycle_id: int = CycleId, db: Session = Depends(get_db)) -> CycleDetail:
    return cycles.archive_cycle(db, cycle_id)


# ---- weeks --------------------------------------------------------------------------------

@router.get("/{cycle_id}/weeks/{week_number}", response_model=WeekDetail)
def get_week(cycle_id: int = CycleId, week_number: int = WeekNo, db: Session = Depends(get_db)) -> WeekDetail:
    return planner.get_week(db, cycle_id, week_number)


@router.post("/{cycle_id}/weeks/{week_number}/copy", response_model=CopyResult)
def copy_week(payload: WeekCopy, cycle_id: int = CycleId, week_number: int = WeekNo,
              db: Session = Depends(get_db)) -> CopyResult:
    """Copy a whole week onto other weeks. Copies are independent of the source."""
    return planner.copy_week(db, cycle_id, week_number, payload)


@router.delete("/{cycle_id}/weeks/{week_number}/days", status_code=status.HTTP_204_NO_CONTENT)
def clear_week(cycle_id: int = CycleId, week_number: int = WeekNo, db: Session = Depends(get_db)) -> Response:
    planner.clear_week(db, cycle_id, week_number)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- days ---------------------------------------------------------------------------------

@router.get("/{cycle_id}/weeks/{week_number}/days/{day_of_week}", response_model=DayDetail)
def get_day(cycle_id: int = CycleId, week_number: int = WeekNo, day_of_week: int = Dow,
            db: Session = Depends(get_db)) -> DayDetail:
    return planner.get_day(db, cycle_id, week_number, day_of_week)


@router.put("/{cycle_id}/weeks/{week_number}/days/{day_of_week}", response_model=DayDetail)
def put_day(payload: DayUpsert, cycle_id: int = CycleId, week_number: int = WeekNo, day_of_week: int = Dow,
            db: Session = Depends(get_db)) -> DayDetail:
    """Create or update a day: workout day vs rest day, title and notes."""
    return planner.put_day(db, cycle_id, week_number, day_of_week, payload)


@router.delete("/{cycle_id}/weeks/{week_number}/days/{day_of_week}", status_code=status.HTTP_204_NO_CONTENT)
def clear_day(cycle_id: int = CycleId, week_number: int = WeekNo, day_of_week: int = Dow,
              db: Session = Depends(get_db)) -> Response:
    planner.clear_day(db, cycle_id, week_number, day_of_week)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{cycle_id}/weeks/{week_number}/days/{day_of_week}/copy", response_model=DayDetail)
def copy_day(payload: DayCopy, cycle_id: int = CycleId, week_number: int = WeekNo, day_of_week: int = Dow,
             db: Session = Depends(get_db)) -> DayDetail:
    """Copy one day's plan onto another day of the same cycle. Returns the target day."""
    return planner.copy_day(db, cycle_id, week_number, day_of_week, payload)


# ---- muscle groups & exercises of a day ----------------------------------------------------

_DAY = "/{cycle_id}/weeks/{week_number}/days/{day_of_week}"


@router.post(_DAY + "/muscle-groups", response_model=DayDetail, status_code=status.HTTP_201_CREATED)
def add_muscle_group(payload: MuscleGroupAssign, cycle_id: int = CycleId, week_number: int = WeekNo,
                     day_of_week: int = Dow, db: Session = Depends(get_db)) -> DayDetail:
    return planner.add_muscle_group(db, cycle_id, week_number, day_of_week, payload)


@router.delete(_DAY + "/muscle-groups/{muscle_group_id}", response_model=DayDetail)
def remove_muscle_group(cycle_id: int = CycleId, week_number: int = WeekNo, day_of_week: int = Dow,
                        muscle_group_id: int = GroupId, db: Session = Depends(get_db)) -> DayDetail:
    """Removes the muscle group and the exercises planned under it."""
    return planner.remove_muscle_group(db, cycle_id, week_number, day_of_week, muscle_group_id)


@router.post(_DAY + "/muscle-groups/{muscle_group_id}/exercises", response_model=DayDetail,
             status_code=status.HTTP_201_CREATED)
def add_exercise(payload: ExerciseAssignment, cycle_id: int = CycleId, week_number: int = WeekNo,
                 day_of_week: int = Dow, muscle_group_id: int = GroupId, db: Session = Depends(get_db)) -> DayDetail:
    """Plan a library exercise under a muscle group of the day (appended at the end)."""
    return planner.add_exercise(db, cycle_id, week_number, day_of_week, muscle_group_id, payload)


@router.put(_DAY + "/muscle-groups/{muscle_group_id}/exercises/order", response_model=DayDetail)
def reorder_exercises(payload: ExerciseOrder, cycle_id: int = CycleId, week_number: int = WeekNo,
                      day_of_week: int = Dow, muscle_group_id: int = GroupId,
                      db: Session = Depends(get_db)) -> DayDetail:
    """Body lists ALL planned-exercise ids of the group in the desired order."""
    return planner.reorder_exercises(db, cycle_id, week_number, day_of_week, muscle_group_id, payload)


@router.post(_DAY + "/cardio", response_model=DayDetail, status_code=status.HTTP_201_CREATED)
def add_cardio(payload: CardioInput, cycle_id: int = CycleId, week_number: int = WeekNo, day_of_week: int = Dow,
               db: Session = Depends(get_db)) -> DayDetail:
    return planner.add_cardio(db, cycle_id, week_number, day_of_week, payload)
