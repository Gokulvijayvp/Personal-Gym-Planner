from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import UtcDateTime

WeightUnit = Literal["kg", "lbs"]
DistanceUnit = Literal["km", "miles"]
WeekStart = Literal["monday", "sunday"]
DateFormat = Literal["DD/MM/YYYY", "DD MMM YYYY", "YYYY-MM-DD"]
ResetSection = Literal["workout", "calendar", "personal", "all"]

# Strict ints: 90.5, "90" and true are rejected rather than silently coerced.
RestSeconds = Annotated[int, Field(strict=True, ge=0, le=3600)]
WorkoutMinutes = Annotated[int, Field(strict=True, ge=1, le=600)]


class SettingsInput(BaseModel):
    """PUT replaces every preference (the form always sends the full set)."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    display_name: str | None = Field(default=None, max_length=50)
    rest_between_sets_seconds: RestSeconds
    rest_between_exercises_seconds: RestSeconds
    target_workout_minutes: WorkoutMinutes
    weight_unit: WeightUnit
    distance_unit: DistanceUnit
    week_start: WeekStart
    date_format: DateFormat

    @field_validator("display_name")
    @classmethod
    def blank_is_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = " ".join(v.split())
        return v or None


class SettingsRead(SettingsInput):
    model_config = ConfigDict(from_attributes=True)
    updated_at: UtcDateTime


class ResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section: ResetSection


class DataCounts(BaseModel):
    exercises: int
    cycles: int
    planned_days: int
    workout_sessions: int


class DataInfo(BaseModel):
    """Safe, read-only facts. Never contains paths or credentials.

    `counts` are the signed-in user's OWN numbers (everybody gets them). The server facts (application, environment,
    database engine, schema version, size, what a backup holds) are for the Admin only: for everyone else they are null / empty."""
    counts: DataCounts
    application: str | None = None
    api_version: str | None = None
    environment: str | None = None
    timezone: str | None = None
    database_engine: str | None = None
    schema_version: str | None = None
    database_size_bytes: int | None = None
    backup_includes: list[str] = []
