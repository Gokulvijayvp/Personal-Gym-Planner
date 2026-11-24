from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.cycle import MAX_WEEKS
from app.schemas.common import UtcDateTime


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShareDayInput(_In):
    cycle_id: int = Field(gt=0)
    week_number: int = Field(ge=1, le=MAX_WEEKS)
    day_of_week: int = Field(ge=0, le=6, description="Monday=0 .. Sunday=6")


class ShareWeekInput(_In):
    cycle_id: int = Field(gt=0)
    week_number: int = Field(ge=1, le=MAX_WEEKS)


class PlanShareCreated(BaseModel):
    code: str                                   # shown as XXXXX-XXXXX
    kind: Literal["day", "week"]
    days_count: int
    expires_at: UtcDateTime


class PlanShareDay(BaseModel):
    day_of_week: int
    name: str                                   # Monday ...
    status: str                                 # "planned" | "rest"
    title: str | None
    muscle_groups: list[str]
    exercise_count: int
    cardio_count: int


class PlanSharePreview(BaseModel):
    """What a code contains (shown before anything is replaced)."""
    kind: Literal["day", "week"]
    days: list[PlanShareDay]
    new_exercises: list[str]                    # exercises the importer does not have yet: they are added to their library
    expires_at: UtcDateTime


class PlanCodeInput(_In):
    code: str = Field(min_length=4, max_length=40)


class PlanImportInput(PlanCodeInput):
    cycle_id: int = Field(gt=0)
    week_number: int = Field(ge=1, le=MAX_WEEKS)
    day_of_week: int | None = Field(default=None, ge=0, le=6, description="Required for a day code: which weekday to put it on")
    confirm_replace: bool = False               # must be true when the target already has a plan: it is deleted first


class PlanImportResult(BaseModel):
    kind: Literal["day", "week"]
    replaced_days: int                          # days of the target that had a plan and were deleted
    imported_days: int
    added_exercises: list[str]
