from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.workout import TimestampMixin
from app.models.ownership import OwnedMixin


class ExerciseSet(OwnedMixin, TimestampMixin, Base):
    """A named group of catalogue exercises for one muscle group, such as "Chest A"."""
    __tablename__ = "exercise_sets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    muscle_group: Mapped[str] = mapped_column(String(80), nullable=False)
    items: Mapped[list["ExerciseSetItem"]] = relationship(
        back_populates="exercise_set", cascade="all, delete-orphan", order_by="ExerciseSetItem.position")


class ExerciseSetItem(OwnedMixin, Base):
    __tablename__ = "exercise_set_items"
    __table_args__ = (Index("ix_exercise_set_items_set", "set_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    set_id: Mapped[int] = mapped_column(ForeignKey("exercise_sets.id", ondelete="CASCADE"), nullable=False)
    catalogue_key: Mapped[str] = mapped_column(String(120), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    exercise_set: Mapped["ExerciseSet"] = relationship(back_populates="items")
