import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.cycle import CycleBrief, MAX_WEEKS
from app.schemas.master_data import CardioActivityRead, MuscleGroupRef, TargetAreaRead, WorkoutTypeRead

DayKind = Literal["empty", "rest", "strength", "cardio", "mixed"]
DayStatus = Literal["unplanned", "planned", "rest"]


# ---- output ---------------------------------------------------------------------------------

class ExerciseRef(BaseModel):
    """The library exercise a plan row points at (never copied into the plan)."""
    id: int
    name: str
    is_active: bool
    muscle_group: MuscleGroupRef
    target_area: TargetAreaRead | None
    workout_type: WorkoutTypeRead | None


class ScheduledExerciseOut(BaseModel):
    id: int
    order: int
    exercise: ExerciseRef
    target_sets: int
    target_reps: str
    target_weight_kg: float | None
    rest_seconds: int | None
    notes: str | None


class ScheduledMuscleGroupOut(BaseModel):
    id: int
    muscle_group: MuscleGroupRef
    notes: str | None
    exercises: list[ScheduledExerciseOut]


class ScheduledCardioOut(BaseModel):
    id: int
    cardio_activity: CardioActivityRead
    duration_minutes: int
    distance_km: float | None
    notes: str | None


class DaySummary(BaseModel):
    day_of_week: int = Field(description="Monday=0 .. Sunday=6")
    date: date
    schedule_id: int | None
    status: DayStatus
    kind: DayKind
    title: str | None
    display_title: str | None = Field(description="Title, or the muscle groups / cardio of the day")
    notes: str | None
    muscle_groups: list[MuscleGroupRef]
    exercise_count: int
    cardio_count: int


class DayDetail(DaySummary):
    cycle_id: int
    week_number: int
    strength: list[ScheduledMuscleGroupOut]
    cardio: list[ScheduledCardioOut]


class WeekDetail(BaseModel):
    cycle: CycleBrief
    week_id: int
    week_number: int
    name: str | None
    notes: str | None
    start_date: date
    end_date: date
    days: list[DaySummary] = Field(description="Always 7 entries, Monday first")


class CopyResult(BaseModel):
    copied_days: int
    target_week_numbers: list[int]


# ---- input ----------------------------------------------------------------------------------

class _In(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


def _blank_none(v: str | None) -> str | None:
    return (v.strip() or None) if v is not None else None


class DayUpsert(_In):
    status: Literal["planned", "rest"]
    title: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)
    clear_workout: bool = Field(
        default=False, description="Required to turn a day that has muscle groups/cardio into a rest day")

    _t = field_validator("title", "notes")(lambda cls, v: _blank_none(v))


class MuscleGroupAssign(_In):
    muscle_group_id: int = Field(gt=0)
    notes: str | None = Field(default=None, max_length=500)

    _n = field_validator("notes")(lambda cls, v: _blank_none(v))


_RANGE = re.compile(r"^(\d{1,3})\s*[-–]\s*(\d{1,3})$")
_NUMBER = re.compile(r"^\d{1,3}$")


class ExerciseAssignment(_In):
    exercise_id: int = Field(gt=0)
    target_sets: int = Field(default=3, ge=1, le=20)
    target_reps: str = Field(default="10", max_length=20, description='"10", a range "8-12", "AMRAP" or "Failure"')
    target_weight_kg: float | None = Field(default=None, ge=0, le=1000)
    rest_seconds: int | None = Field(default=None, ge=0, le=3600)
    notes: str | None = Field(default=None, max_length=500)

    _n = field_validator("notes")(lambda cls, v: _blank_none(v))

    @field_validator("target_reps")
    @classmethod
    def valid_reps(cls, v: str) -> str:
        v = re.sub(r"\s+", " ", v).strip()
        if v.lower() == "amrap":
            return "AMRAP"
        if v.lower() == "failure":
            return "Failure"
        if _NUMBER.match(v):
            if int(v) < 1:
                raise ValueError("Reps must be at least 1.")
            return str(int(v))
        m = _RANGE.match(v)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            if lo < 1 or lo > hi:
                raise ValueError("Use a range like 8-12 (low to high, at least 1).")
            return f"{lo}-{hi}"
        raise ValueError("Use a number, a range like 8-12, AMRAP or Failure.")


class ExerciseOrder(_In):
    schedule_exercise_ids: list[int] = Field(min_length=1, max_length=50)


class CardioInput(_In):
    cardio_activity_id: int = Field(gt=0)
    duration_minutes: int = Field(ge=1, le=600)
    distance_km: float | None = Field(default=None, ge=0, le=1000)
    notes: str | None = Field(default=None, max_length=500)

    _n = field_validator("notes")(lambda cls, v: _blank_none(v))


class DayCopy(_In):
    target_week_number: int = Field(ge=1, le=MAX_WEEKS)
    target_day_of_week: int = Field(ge=0, le=6)
    overwrite: bool = False


class WeekCopy(_In):
    target_week_numbers: list[int] = Field(min_length=1, max_length=MAX_WEEKS)
    overwrite: bool = False

    @field_validator("target_week_numbers")
    @classmethod
    def unique_valid(cls, v: list[int]) -> list[int]:
        if any(n < 1 or n > MAX_WEEKS for n in v):
            raise ValueError(f"Week numbers must be between 1 and {MAX_WEEKS}.")
        return list(dict.fromkeys(v))
