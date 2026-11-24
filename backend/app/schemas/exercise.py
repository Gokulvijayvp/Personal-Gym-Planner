import re
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import UtcDateTime
from app.schemas.exercise_master import ExerciseMasterRef
from app.schemas.master_data import MuscleGroupRef, TargetAreaRead, WorkoutTypeRead


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


class ExerciseInput(BaseModel):
    """Writable exercise fields (create = update; PUT replaces all of them)."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    muscle_group_id: int = Field(gt=0, description="Primary muscle group")
    secondary_muscle_group_ids: list[int] = Field(default_factory=list, max_length=10)
    target_area_id: int | None = Field(default=None, gt=0)
    workout_type_id: int | None = Field(default=None, gt=0)
    instructions: str | None = Field(default=None, max_length=5000)
    media_url: str | None = Field(default=None, max_length=500)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def collapse_name_whitespace(cls, v: str) -> str:
        v = re.sub(r"\s+", " ", v).strip()
        if len(v) < 2:
            raise ValueError("String should have at least 2 characters")
        return v

    @field_validator("description", "instructions", "media_url")
    @classmethod
    def empty_to_none(cls, v: str | None) -> str | None:
        return _blank_to_none(v)

    @field_validator("media_url")
    @classmethod
    def media_url_must_be_http(cls, v: str | None) -> str | None:
        if v is None:
            return v
        parsed = urlparse(v)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Must be a valid http(s) URL")
        return v

    @field_validator("secondary_muscle_group_ids")
    @classmethod
    def unique_positive_ids(cls, v: list[int]) -> list[int]:
        if any(i <= 0 for i in v):
            raise ValueError("IDs must be positive integers")
        return list(dict.fromkeys(v))  # de-duplicate, keep order


class ExerciseCreate(ExerciseInput):
    pass


class ExerciseUpdate(ExerciseInput):
    pass


class ExerciseStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: bool


class ExerciseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    muscle_group: MuscleGroupRef
    secondary_muscle_groups: list[MuscleGroupRef]
    target_area: TargetAreaRead | None
    workout_type: WorkoutTypeRead | None
    exercise_master: ExerciseMasterRef | None = None
    instructions: str | None
    media_url: str | None
    is_active: bool
    usage_count: int = 0  # planned/logged references; > 0 means it can't be deleted, only deactivated
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ExerciseListResponse(BaseModel):
    items: list[ExerciseRead]
    total: int = Field(description="Exercises matching the current filters")
    total_all: int = Field(description="All exercises, ignoring filters")
    page: int
    page_size: int
    pages: int


ExerciseSort = Literal["name", "created_at", "updated_at"]
SortOrder = Literal["asc", "desc"]
