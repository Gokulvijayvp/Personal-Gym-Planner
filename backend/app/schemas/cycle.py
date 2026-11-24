import re
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.timezone import is_monday
from app.models.enums import CycleStatus
from app.schemas.common import UtcDateTime

MAX_WEEKS = 52


class CycleInput(BaseModel):
    """Writable cycle fields (create = update)."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    start_date: date = Field(description="Local calendar date (Asia/Kolkata); must be a Monday")
    total_weeks: int = Field(ge=1, le=MAX_WEEKS)

    @field_validator("name")
    @classmethod
    def collapse_name(cls, v: str) -> str:
        v = re.sub(r"\s+", " ", v).strip()
        if len(v) < 2:
            raise ValueError("String should have at least 2 characters")
        return v

    @field_validator("description")
    @classmethod
    def blank_to_none(cls, v: str | None) -> str | None:
        return (v.strip() or None) if v is not None else None

    @field_validator("start_date")
    @classmethod
    def must_be_monday(cls, v: date) -> date:
        if not 2000 <= v.year <= 2100:
            raise ValueError("Start date must be between the years 2000 and 2100.")
        if not is_monday(v):
            raise ValueError("A cycle must start on a Monday so every week runs Monday to Sunday.")
        return v


class WeekStats(BaseModel):
    id: int
    week_number: int
    name: str | None
    notes: str | None
    start_date: date
    end_date: date
    planned_days: int
    rest_days: int
    exercise_count: int
    cardio_count: int


class CycleSummary(BaseModel):
    id: int
    name: str
    description: str | None
    start_date: date
    end_date: date = Field(description="Calculated: start + 7 x weeks - 1 days (a Sunday)")
    total_weeks: int
    status: CycleStatus
    planned_days: int
    rest_days: int
    exercise_count: int
    cardio_count: int
    created_at: UtcDateTime
    updated_at: UtcDateTime


class CycleDetail(CycleSummary):
    weeks: list[WeekStats]


class CycleBrief(BaseModel):
    id: int
    name: str
    status: CycleStatus
    start_date: date
    end_date: date
    total_weeks: int
