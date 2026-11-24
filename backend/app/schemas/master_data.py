from pydantic import BaseModel, ConfigDict


class TargetAreaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    muscle_group_id: int


class MuscleGroupRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class MuscleGroupRead(MuscleGroupRef):
    """Muscle group with the target areas that belong to it (drives dependent dropdowns)."""
    sort_order: int
    target_areas: list[TargetAreaRead]


class WorkoutTypeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class CardioActivityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
