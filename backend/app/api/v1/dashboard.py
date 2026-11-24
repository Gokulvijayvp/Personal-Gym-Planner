from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.dashboard import DashboardResponse
from app.services import dashboard_service as service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("", response_model=DashboardResponse)
def get_dashboard(db: Session = Depends(get_db)) -> DashboardResponse:
    """Read-only overview for the Home page: active cycle, today's plan, this week, counts and setup status.

    Built from the Weekly Planner / Calendar data; it holds nothing of its own and says nothing about
    completed workouts (workout logging does not exist yet).
    """
    return service.get_dashboard(db)
