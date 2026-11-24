from datetime import date

from pydantic import BaseModel

from app.schemas.common import UtcDateTime


class HealthResponse(BaseModel):
    status: str
    application: str
    environment: str
    timezone: str
    server_time: UtcDateTime
    today: date  # calendar date in the application timezone
