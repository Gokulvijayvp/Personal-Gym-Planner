import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.exercise_motion import MOTIONS
from app.schemas.common import UtcDateTime

MotionName = Literal[tuple(MOTIONS)]  # type: ignore[valid-type]


class ExerciseMasterRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    icon_motion: str


class ExerciseMasterInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=2, max_length=160)
    # Omitted on create = guessed from the name; omitted on update = unchanged.
    icon_motion: MotionName | None = None

    @field_validator("name")
    @classmethod
    def collapse_whitespace(cls, v: str) -> str:
        v = re.sub(r"\s+", " ", v).strip()
        if len(v) < 2:
            raise ValueError("String should have at least 2 characters")
        return v


class ExerciseMasterCreate(ExerciseMasterInput):
    pass


class ExerciseMasterUpdate(ExerciseMasterInput):
    pass


class ExerciseMasterRead(ExerciseMasterRef):
    is_active: bool
    usage_count: int = 0          # library exercises linked to this master
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ExerciseMasterListResponse(BaseModel):
    items: list[ExerciseMasterRead]
    motions: dict[str, str]       # allowed icon motions and their labels
