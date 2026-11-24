from pydantic import BaseModel, Field, field_validator

from app.schemas.common import UtcDateTime


class ExerciseSetInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    muscle_group: str = Field(min_length=1, max_length=80)
    exercise_keys: list[str] = Field(min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def _tidy(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Give the set a name.")
        return v


class ExerciseSetExercise(BaseModel):
    key: str
    name: str
    equipment: str
    icon_motion: str


class ExerciseSetRead(BaseModel):
    id: int
    name: str
    muscle_group: str
    exercises: list[ExerciseSetExercise]
    created_at: UtcDateTime


class ShareCreated(BaseModel):
    code: str                                   # shown as XXXXX-XXXXX
    sets_count: int
    expires_at: UtcDateTime


class SharedSetSummary(BaseModel):
    name: str
    muscle_group: str
    exercise_count: int


class SharedPreview(BaseModel):
    """What a code contains, shown before anything is replaced."""
    sets_count: int
    sets: list[SharedSetSummary]
    expires_at: UtcDateTime


class ShareCodeInput(BaseModel):
    code: str = Field(min_length=4, max_length=40)


class ImportInput(ShareCodeInput):
    confirm_replace: bool = False               # must be true: importing DELETES the current list first


class ImportResult(BaseModel):
    removed: int
    imported: int
    sets: list[ExerciseSetRead]
