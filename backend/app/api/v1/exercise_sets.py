from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.db.session import get_db
from app.schemas.exercise_set import (
    ExerciseSetInput, ExerciseSetRead, ImportInput, ImportResult, ShareCodeInput, ShareCreated, SharedPreview,
)
from app.services import exercise_set_service as service

router = APIRouter(prefix="/exercise-sets", tags=["My exercises"])


@router.post("/share", response_model=ShareCreated, status_code=status.HTTP_201_CREATED)
def share_my_sets(db: Session = Depends(get_db)) -> ShareCreated:
    """Make a code for your whole My exercises list. Whoever has the code can copy the list (replacing theirs)."""
    rate_limit.hit(f"share-create:{db.info.get('user_id')}", 20, 3600, "You have made many share codes. Try again later.")
    return service.create_share(db)


def _throttle_lookup(request: Request, db: Session) -> None:
    """Codes are unguessable, but cap how fast anyone can try them anyway."""
    rate_limit.hit(f"share-ip:{rate_limit.client_ip(request)}", 40, 600)
    rate_limit.hit(f"share-user:{db.info.get('user_id')}", 20, 600, "Too many tries. Wait a few minutes and try again.")


@router.post("/shared/preview", response_model=SharedPreview)
def preview_shared(data: ShareCodeInput, request: Request, db: Session = Depends(get_db)) -> SharedPreview:
    """What a code contains (for the confirmation screen). Changes nothing."""
    _throttle_lookup(request, db)
    return service.preview_share(db, data.code)


@router.post("/import", response_model=ImportResult)
def import_shared(data: ImportInput, request: Request, db: Session = Depends(get_db)) -> ImportResult:
    """DELETE your current sets and replace them with the shared list. Needs confirm_replace=true."""
    _throttle_lookup(request, db)
    return service.import_share(db, data.code, data.confirm_replace)


@router.get("", response_model=list[ExerciseSetRead])
def list_sets(db: Session = Depends(get_db)) -> list[ExerciseSetRead]:
    return service.list_sets(db)


@router.post("", response_model=ExerciseSetRead, status_code=status.HTTP_201_CREATED)
def create_set(data: ExerciseSetInput, db: Session = Depends(get_db)) -> ExerciseSetRead:
    return service.create_set(db, data)


@router.put("/{set_id}", response_model=ExerciseSetRead)
def update_set(set_id: int, data: ExerciseSetInput, db: Session = Depends(get_db)) -> ExerciseSetRead:
    return service.update_set(db, set_id, data)


@router.delete("/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_set(set_id: int, db: Session = Depends(get_db)) -> Response:
    service.delete_set(db, set_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
