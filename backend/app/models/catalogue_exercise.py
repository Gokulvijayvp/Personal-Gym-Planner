from sqlalchemy import Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.workout import TimestampMixin


class CatalogueExercise(TimestampMixin, Base):
    """An exercise added to the catalogue by the admin. Shared: every signed-in user sees it, only the admin can add one."""
    __tablename__ = "catalogue_exercises"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)         # url-safe name, like the built-in ones
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    muscle_group: Mapped[str] = mapped_column(String(80), nullable=False)
    target_area: Mapped[str | None] = mapped_column(String(80))
    equipment: Mapped[str] = mapped_column(String(80), nullable=False)                 # free text
    movement: Mapped[str | None] = mapped_column(String(200))                          # free text
    icon_motion: Mapped[str] = mapped_column(String(30), nullable=False)


Index("ux_catalogue_exercises_name_lower", func.lower(CatalogueExercise.name), unique=True)
