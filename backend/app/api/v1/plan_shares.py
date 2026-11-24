from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.db.session import get_db
from app.schemas.plan_share import (
    PlanCodeInput, PlanImportInput, PlanImportResult, PlanShareCreated, PlanSharePreview, ShareDayInput, ShareWeekInput,
)
from app.services import plan_share_service as service

router = APIRouter(prefix="/plan-shares", tags=["Share workout plans"])


def _throttle_lookup(request: Request, db: Session) -> None:
    """Codes are unguessable, but cap how fast anyone can try them anyway."""
    rate_limit.hit(f"share-ip:{rate_limit.client_ip(request)}", 40, 600)
    rate_limit.hit(f"share-user:{db.info.get('user_id')}", 20, 600, "Too many tries. Wait a few minutes and try again.")


def _throttle_create(db: Session) -> None:
    rate_limit.hit(f"plan-share-create:{db.info.get('user_id')}", 30, 3600, "You have made many share codes. Try again later.")


@router.post("/day", response_model=PlanShareCreated, status_code=status.HTTP_201_CREATED)
def share_day(data: ShareDayInput, db: Session = Depends(get_db)) -> PlanShareCreated:
    """A code for one planned day. Whoever has it can copy that day into their own plan."""
    _throttle_create(db)
    return service.share_day(db, data.cycle_id, data.week_number, data.day_of_week)


@router.post("/week", response_model=PlanShareCreated, status_code=status.HTTP_201_CREATED)
def share_week(data: ShareWeekInput, db: Session = Depends(get_db)) -> PlanShareCreated:
    """A code for one whole planned week."""
    _throttle_create(db)
    return service.share_week(db, data.cycle_id, data.week_number)


@router.post("/preview", response_model=PlanSharePreview)
def preview(data: PlanCodeInput, request: Request, db: Session = Depends(get_db)) -> PlanSharePreview:
    """What a code contains (day or week). Changes nothing."""
    _throttle_lookup(request, db)
    return service.preview(db, data.code)


@router.post("/import", response_model=PlanImportResult)
def import_plan(data: PlanImportInput, request: Request, db: Session = Depends(get_db)) -> PlanImportResult:
    """Copy a shared day/week into one of your cycles. If the target already has a plan it is replaced,
    which needs confirm_replace=true (otherwise 409 target_not_empty)."""
    _throttle_lookup(request, db)
    return service.import_share(db, data.code, data.cycle_id, data.week_number, data.day_of_week, data.confirm_replace)
