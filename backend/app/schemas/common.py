from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, PlainSerializer

from app.core.timezone import to_utc


def _serialize_utc(value: datetime) -> str:
    # Naive values come from DB columns (naive UTC by convention) -> emit explicit "Z".
    return to_utc(value).isoformat().replace("+00:00", "Z")


# Use this type for every datetime in API response schemas.
UtcDateTime = Annotated[datetime, PlainSerializer(_serialize_utc, return_type=str)]


class ErrorDetail(BaseModel):
    field: str | None = None
    message: str
    type: str | None = None


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail] | None = None
    reference: str | None = None


class ErrorResponse(BaseModel):
    """Every non-2xx response from the API has this shape."""
    error: ErrorBody
