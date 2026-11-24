from pydantic import BaseModel, ConfigDict, Field, field_validator


class MediaRead(BaseModel):
    id: int
    kind: str                        # "image" | "video"
    content_type: str
    url: str                         # where the browser loads the file from


class CatalogueItem(BaseModel):
    key: str
    name: str
    muscle_group: str
    target_area: str | None
    equipment: str
    icon_motion: str
    movement: str | None = None      # free-text movement description (admin-added exercises)
    custom: bool = False             # added by the admin rather than built in
    in_library: bool
    media: list[MediaRead] = []      # uploaded pictures first, videos last
    exercise_id: int | None = None   # the user's own exercise with this name, if any


class CatalogueResponse(BaseModel):
    items: list[CatalogueItem]
    muscle_groups: list[str]         # in display order, only groups that have entries
    motions: dict[str, str]


class CatalogueCreate(BaseModel):
    """What the admin fills in to add an exercise. Pictures and videos are uploaded afterwards to /{key}/media."""
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    muscle_group: str = Field(min_length=1, max_length=80)
    target_area: str | None = Field(default=None, max_length=80)
    equipment: str = Field(min_length=1, max_length=80)
    movement: str | None = Field(default=None, max_length=200)

    @field_validator("name", "muscle_group", "target_area", "equipment", "movement", mode="before")
    @classmethod
    def _tidy(cls, v):
        return " ".join(v.split()) if isinstance(v, str) else v          # trim and collapse spaces; a blank required field then fails its min_length
