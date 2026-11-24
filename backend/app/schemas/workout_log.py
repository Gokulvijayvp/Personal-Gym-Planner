import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.common import UtcDateTime

LogStatus = Literal["pending", "completed", "skipped"]
SessionStatus = Literal["in_progress", "completed", "cancelled"]
Source = Literal["plan", "blank"]

# Fixed-point inputs, canonical units: kg / km. More decimals than the column holds are rejected, not rounded.
Kg = Annotated[Decimal, Field(ge=0, le=1000, max_digits=8, decimal_places=3)]
Km = Annotated[Decimal, Field(ge=0, le=1000, max_digits=7, decimal_places=3)]
Kmh = Annotated[Decimal, Field(ge=0, le=200, max_digits=6, decimal_places=2)]
Reps = Annotated[int, Field(strict=True, ge=0, le=1000)]
RestSeconds = Annotated[int, Field(strict=True, ge=0, le=7200)]
Minutes = Annotated[int, Field(strict=True, ge=0, le=1440)]
Calories = Annotated[int, Field(strict=True, ge=0, le=20000)]
Notes = Annotated[str, Field(max_length=2000)]


def _blank_to_none(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


# ---- output ---------------------------------------------------------------------------------

class SetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    set_number: int
    status: LogStatus
    target_reps: str | None
    target_weight_kg: float | None
    actual_reps: int | None
    actual_weight_kg: float | None
    rest_seconds: int | None
    notes: str | None


class ExerciseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    position: int
    exercise_id: int | None = Field(description="null once the library exercise has been deleted; the name below remains")
    exercise_name: str
    muscle_group_name: str | None
    workout_type_name: str | None
    status: LogStatus
    from_plan: bool
    target_sets: int | None
    target_reps: str | None
    target_weight_kg: float | None
    target_rest_seconds: int | None
    plan_notes: str | None
    notes: str | None
    sets: list[SetOut]


class CardioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    position: int
    cardio_activity_id: int | None
    activity_name: str
    status: LogStatus
    from_plan: bool
    target_duration_minutes: int | None
    target_distance_km: float | None
    plan_notes: str | None
    duration_minutes: int | None
    distance_km: float | None
    calories: int | None
    speed_kmh: float | None
    resistance: str | None
    notes: str | None


class SessionSummary(BaseModel):
    """Counted from what was actually logged. Planned targets never count as performance."""
    total_exercises: int
    completed_exercises: int
    skipped_exercises: int
    total_sets: int
    completed_sets: int
    cardio_entries: int
    cardio_completed: int
    cardio_minutes: int = Field(description="Minutes of cardio marked completed")


class SessionDetail(BaseModel):
    id: int
    workout_date: dt.date
    status: SessionStatus
    source: Source
    title: str | None
    cycle_name: str | None
    week_number: int | None
    daily_schedule_id: int | None
    started_at: UtcDateTime
    ended_at: UtcDateTime | None
    duration_seconds: int = Field(description="ended_at - started_at, or now - started_at while in progress")
    notes: str | None
    cancel_reason: str | None
    summary: SessionSummary
    exercises: list[ExerciseOut]
    cardio: list[CardioOut]
    updated_at: UtcDateTime


class SessionListItem(BaseModel):
    id: int
    workout_date: dt.date
    status: SessionStatus
    source: Source
    title: str | None
    cycle_name: str | None
    started_at: UtcDateTime
    ended_at: UtcDateTime | None
    duration_seconds: int
    exercise_count: int
    completed_exercise_count: int
    completed_sets: int
    cardio_minutes: int
    exercise_names: list[str] = Field(description="First few exercise names, for the list")


class SessionList(BaseModel):
    items: list[SessionListItem]
    total: int
    page: int
    page_size: int


class SessionRef(BaseModel):
    """Small pointer used by Home and the Calendar."""
    id: int
    status: SessionStatus
    workout_date: dt.date
    title: str | None = None


class RecentSession(BaseModel):
    id: int
    workout_date: dt.date
    title: str | None
    cycle_name: str | None
    ended_at: UtcDateTime
    duration_seconds: int
    completed_exercise_count: int
    completed_sets: int
    cardio_minutes: int


# ---- input ----------------------------------------------------------------------------------

class _In(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class StartInput(_In):
    """Start from a planned day (`source="plan"`) or a blank workout (`source="blank"`)."""
    source: Source
    cycle_id: int | None = Field(default=None, gt=0)
    week_number: int | None = Field(default=None, ge=1)
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    workout_date: dt.date | None = Field(default=None, description="Blank workouts only; defaults to today")

    @model_validator(mode="after")
    def check_combination(self):
        planned = (self.cycle_id, self.week_number, self.day_of_week)
        if self.source == "plan":
            if any(v is None for v in planned):
                raise ValueError("cycle_id, week_number and day_of_week are required to start from a plan.")
            if self.workout_date is not None:
                raise ValueError("A planned workout takes its date from the plan.")
        elif any(v is not None for v in planned):
            raise ValueError("A blank workout cannot reference a plan.")
        return self


class CompleteInput(_In):
    notes: Notes | None = None

    @field_validator("notes")
    @classmethod
    def clean(cls, v):
        return _blank_to_none(v)


class CancelInput(_In):
    reason: Notes | None = None

    @field_validator("reason")
    @classmethod
    def clean(cls, v):
        return _blank_to_none(v)


class ExerciseAdd(_In):
    exercise_id: int = Field(gt=0)


class ExerciseUpdate(_In):
    """PATCH: only the fields sent are changed."""
    status: LogStatus | None = None
    notes: Notes | None = None

    @field_validator("notes")
    @classmethod
    def clean(cls, v):
        return _blank_to_none(v)

    @model_validator(mode="after")
    def not_null_status(self):
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("status cannot be null.")
        return self


class ReorderInput(_In):
    exercise_ids: list[int] = Field(min_length=1, max_length=100)


class SetUpdate(_In):
    """PATCH: only the fields sent are changed; null clears a value. Targets are not editable."""
    actual_reps: Reps | None = None
    actual_weight_kg: Kg | None = None
    rest_seconds: RestSeconds | None = None
    status: LogStatus | None = None
    notes: Notes | None = None

    @field_validator("notes")
    @classmethod
    def clean(cls, v):
        return _blank_to_none(v)

    @model_validator(mode="after")
    def not_null_status(self):
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("status cannot be null.")
        return self


class CardioAdd(_In):
    cardio_activity_id: int = Field(gt=0)


class CardioUpdate(_In):
    status: LogStatus | None = None
    duration_minutes: Minutes | None = None
    distance_km: Km | None = None
    calories: Calories | None = None
    speed_kmh: Kmh | None = None
    resistance: Annotated[str, Field(max_length=40)] | None = None
    notes: Notes | None = None

    @field_validator("notes", "resistance")
    @classmethod
    def clean(cls, v):
        return _blank_to_none(v)

    @model_validator(mode="after")
    def not_null_status(self):
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("status cannot be null.")
        return self
