from sqlalchemy import Boolean, CheckConstraint, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.exercise_motion import MOTIONS
from app.db.base import Base
from app.models.workout import TimestampMixin

_MOTION_LIST = ",".join(f"'{m}'" for m in MOTIONS)


class ExerciseMaster(TimestampMixin, Base):
    """The master list of exercise names. Each has an icon *motion* that the app draws as an animated figure.

    Library exercises point at a master (`exercises.exercise_master_id`). Names are unique ignoring case; the
    unique index is an expression index, so it is created in the migration and declared here for the model.
    """
    __tablename__ = "exercise_masters"
    __table_args__ = (CheckConstraint(f"icon_motion IN ({_MOTION_LIST})", name="ck_exercise_masters_motion"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    icon_motion: Mapped[str] = mapped_column(String(12), nullable=False, server_default="generic")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="1", default=True)


# NOTE: SQLAlchemy cannot reflect expression indexes on SQLite, so a future *batch* migration that rebuilds
# this table must re-create this index explicitly (same caveat as ux_exercises_name_lower).
Index("ux_exercise_masters_name_lower", func.lower(ExerciseMaster.name), unique=True)
