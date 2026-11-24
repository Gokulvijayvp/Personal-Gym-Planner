from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.schemas.exercise_master import (
    ExerciseMasterCreate, ExerciseMasterListResponse, ExerciseMasterRead, ExerciseMasterUpdate,
)
from app.services import exercise_master_service as service

router = APIRouter(prefix="/exercise-masters", tags=["Exercise masters"])


@router.get("", response_model=ExerciseMasterListResponse)
def list_exercise_masters(db: Session = Depends(get_db)) -> ExerciseMasterListResponse:
    return service.list_masters(db)


@router.get("/guess")
def guess_icon(name: str = Query("", max_length=200)) -> dict:
    """The icon motion Auto would pick for this name (same rule used when saving)."""
    from app.core.exercise_motion import MOTIONS, guess_motion
    motion = guess_motion(" ".join(name.split()))
    return {"icon_motion": motion, "label": MOTIONS[motion]}


@router.post("", response_model=ExerciseMasterRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_exercise_master(payload: ExerciseMasterCreate, db: Session = Depends(get_db)) -> ExerciseMasterRead:
    return service.create_master(db, payload)


@router.put("/{master_id}", response_model=ExerciseMasterRead, dependencies=[Depends(require_admin)])
def update_exercise_master(master_id: int, payload: ExerciseMasterUpdate,
                           db: Session = Depends(get_db)) -> ExerciseMasterRead:
    return service.update_master(db, master_id, payload)


@router.delete("/{master_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def delete_exercise_master(master_id: int, db: Session = Depends(get_db)) -> Response:
    service.delete_master(db, master_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
