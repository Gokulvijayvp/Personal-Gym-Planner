from sqlalchemy import CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.workout import TimestampMixin
from app.models.ownership import OwnedMixin


class AppSettings(OwnedMixin, TimestampMixin, Base):
    """One row of application preferences per user (found by user_id).

    Units and date formats are *display* preferences: stored workout data stays in kg / km / ISO dates.
    """
    __tablename__ = "app_settings"
    __table_args__ = (
        CheckConstraint("rest_between_sets_seconds BETWEEN 0 AND 3600", name="ck_app_settings_rest_sets"),
        CheckConstraint("rest_between_exercises_seconds BETWEEN 0 AND 3600", name="ck_app_settings_rest_exercises"),
        CheckConstraint("target_workout_minutes BETWEEN 1 AND 600", name="ck_app_settings_target_minutes"),
        CheckConstraint("weight_unit IN ('kg','lbs')", name="ck_app_settings_weight_unit"),
        CheckConstraint("distance_unit IN ('km','miles')", name="ck_app_settings_distance_unit"),
        CheckConstraint("week_start IN ('monday','sunday')", name="ck_app_settings_week_start"),
        CheckConstraint("date_format IN ('DD/MM/YYYY','DD MMM YYYY','YYYY-MM-DD')", name="ck_app_settings_date_format"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    display_name: Mapped[str | None] = mapped_column(String(50))
    rest_between_sets_seconds: Mapped[int] = mapped_column(Integer, nullable=False, server_default="90")
    rest_between_exercises_seconds: Mapped[int] = mapped_column(Integer, nullable=False, server_default="120")
    target_workout_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="60")
    weight_unit: Mapped[str] = mapped_column(String(3), nullable=False, server_default="kg")
    distance_unit: Mapped[str] = mapped_column(String(5), nullable=False, server_default="km")
    week_start: Mapped[str] = mapped_column(String(6), nullable=False, server_default="monday")
    date_format: Mapped[str] = mapped_column(String(12), nullable=False, server_default="DD MMM YYYY")
