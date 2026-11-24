from fastapi import APIRouter
from app.core.config import settings
from app.core.timezone import today_local, utc_now
from app.schemas.health import HealthResponse

router = APIRouter(tags=["Health"])

@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    return HealthResponse(
        status="healthy",
        application=settings.app_name,
        environment=settings.app_env,
        timezone=settings.timezone,
        server_time=utc_now(),
        today=today_local(),
    )
