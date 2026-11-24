from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.calendar import CalendarResponse
from app.services import calendar_service

router = APIRouter(prefix="/calendar", tags=["Calendar"])


@router.get("", response_model=CalendarResponse)
def get_calendar(
    start: date = Query(description="First date, YYYY-MM-DD (Asia/Kolkata calendar date)"),
    end: date = Query(description="Last date, inclusive. At most 62 days after start."),
    db: Session = Depends(get_db),
) -> CalendarResponse:
    """Read-only. Every date in the range, with its cycle, cycle week and the planner's plan for it."""
    return calendar_service.get_calendar(db, start, end)
