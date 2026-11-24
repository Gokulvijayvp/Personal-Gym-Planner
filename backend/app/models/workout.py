from datetime import date, datetime
from sqlalchemy import (
    String, Integer, Boolean, Date, DateTime, ForeignKey, Text, Float,
    UniqueConstraint, Index, JSON, Enum as SAEnum, Table, Column, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.timezone import utc_now_naive
from app.db.base import Base
from app.models.enums import CycleStatus, ScheduleStatus
from app.models.ownership import OwnedMixin

class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False)

class WorkoutCycle(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "workout_cycles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_weeks: Mapped[int] = mapped_column(Integer, nullable=False)
    repeat_cycle: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[CycleStatus] = mapped_column(SAEnum(CycleStatus), default=CycleStatus.draft, server_default="draft", nullable=False)
    weekly_plans: Mapped[list["WeeklyPlan"]] = relationship(
        back_populates="cycle", cascade="all, delete-orphan", order_by="WeeklyPlan.week_number")

class WeeklyPlan(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "weekly_plans"
    __table_args__ = (UniqueConstraint("cycle_id", "week_number", name="uq_weekly_plan_cycle_week"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cycle_id: Mapped[int] = mapped_column(ForeignKey("workout_cycles.id", ondelete="CASCADE"), nullable=False)
    week_number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str | None] = mapped_column(String(120))
    focus_format: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(Text)
    cycle: Mapped["WorkoutCycle"] = relationship(back_populates="weekly_plans")
    daily_schedules: Mapped[list["DailySchedule"]] = relationship(
        back_populates="weekly_plan", cascade="all, delete-orphan", order_by="DailySchedule.day_of_week")

class DailySchedule(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "daily_schedules"
    __table_args__ = (
        UniqueConstraint("weekly_plan_id", "day_of_week", name="uq_schedule_weekday"),
        Index("ix_daily_schedules_weekday", "day_of_week"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    weekly_plan_id: Mapped[int] = mapped_column(ForeignKey("weekly_plans.id", ondelete="CASCADE"), nullable=False)
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)  # Monday=0 ... Sunday=6
    status: Mapped[ScheduleStatus] = mapped_column(SAEnum(ScheduleStatus), default=ScheduleStatus.planned, nullable=False)
    title: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    weekly_plan: Mapped["WeeklyPlan"] = relationship(back_populates="daily_schedules")
    muscle_groups: Mapped[list["ScheduleMuscleGroup"]] = relationship(
        back_populates="daily_schedule", cascade="all, delete-orphan", order_by="ScheduleMuscleGroup.id")
    cardio_items: Mapped[list["ScheduleCardio"]] = relationship(
        back_populates="daily_schedule", cascade="all, delete-orphan", order_by="ScheduleCardio.sort_order, ScheduleCardio.id")

class MuscleGroup(TimestampMixin, Base):
    __tablename__ = "muscle_groups"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exercises: Mapped[list["Exercise"]] = relationship(back_populates="muscle_group")
    target_areas: Mapped[list["TargetArea"]] = relationship(
        back_populates="muscle_group", order_by="TargetArea.sort_order", cascade="all, delete-orphan")

class TargetArea(TimestampMixin, Base):
    """Master data: sub-areas of a muscle group (e.g. Chest -> Upper Chest)."""
    __tablename__ = "target_areas"
    __table_args__ = (UniqueConstraint("muscle_group_id", "name", name="uq_target_area_group_name"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    muscle_group_id: Mapped[int] = mapped_column(ForeignKey("muscle_groups.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    muscle_group: Mapped["MuscleGroup"] = relationship(back_populates="target_areas")

class WorkoutType(TimestampMixin, Base):
    __tablename__ = "workout_types"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    exercises: Mapped[list["Exercise"]] = relationship(back_populates="workout_type")

exercise_secondary_muscle_groups = Table(
    "exercise_secondary_muscle_groups", Base.metadata,
    Column("exercise_id", ForeignKey("exercises.id", ondelete="CASCADE"), primary_key=True),
    Column("muscle_group_id", ForeignKey("muscle_groups.id", ondelete="RESTRICT"), primary_key=True),
)

class Exercise(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "exercises"
    __table_args__ = (
        Index("ix_exercises_muscle_group_id", "muscle_group_id"),
        Index("ix_exercises_target_area_id", "target_area_id"),
        Index("ix_exercises_exercise_master_id", "exercise_master_id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    muscle_group_id: Mapped[int] = mapped_column(ForeignKey("muscle_groups.id", ondelete="RESTRICT"), nullable=False)
    workout_type_id: Mapped[int | None] = mapped_column(ForeignKey("workout_types.id", ondelete="SET NULL"))
    target_area_id: Mapped[int | None] = mapped_column(ForeignKey("target_areas.id", ondelete="SET NULL"))
    instructions: Mapped[str | None] = mapped_column(Text)
    media_url: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    exercise_master_id: Mapped[int | None] = mapped_column(ForeignKey("exercise_masters.id", ondelete="SET NULL"))
    muscle_group: Mapped["MuscleGroup"] = relationship(back_populates="exercises")
    exercise_master: Mapped["ExerciseMaster | None"] = relationship("ExerciseMaster")
    workout_type: Mapped["WorkoutType | None"] = relationship(back_populates="exercises")
    target_area: Mapped["TargetArea | None"] = relationship()
    secondary_muscle_groups: Mapped[list["MuscleGroup"]] = relationship(
        secondary=exercise_secondary_muscle_groups, order_by="MuscleGroup.sort_order")

# Case-insensitive unique exercise names (SQLite expression index; created in migration b8d4f1a2c6e7).
# NOTE: SQLAlchemy cannot reflect expression indexes on SQLite, so any future Alembic *batch* migration
# that rebuilds `exercises` must re-create this index explicitly (autogenerate will not do it).
Index("ux_exercises_user_name_lower", Exercise.user_id, func.lower(Exercise.name), unique=True)   # names are unique per person, not across people

class ScheduleMuscleGroup(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "schedule_muscle_groups"
    __table_args__ = (UniqueConstraint("daily_schedule_id", "muscle_group_id", name="uq_schedule_muscle_group"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    daily_schedule_id: Mapped[int] = mapped_column(ForeignKey("daily_schedules.id", ondelete="CASCADE"), nullable=False)
    muscle_group_id: Mapped[int] = mapped_column(ForeignKey("muscle_groups.id", ondelete="RESTRICT"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    daily_schedule: Mapped["DailySchedule"] = relationship(back_populates="muscle_groups")
    muscle_group: Mapped["MuscleGroup"] = relationship()
    exercises: Mapped[list["ScheduleExercise"]] = relationship(
        back_populates="schedule_muscle_group", cascade="all, delete-orphan", order_by="ScheduleExercise.exercise_order")

class ScheduleExercise(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "schedule_exercises"
    __table_args__ = (
        UniqueConstraint("schedule_muscle_group_id", "exercise_order", name="uq_schedule_exercise_order"),
        Index("ix_schedule_exercises_exercise_id", "exercise_id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    schedule_muscle_group_id: Mapped[int] = mapped_column(ForeignKey("schedule_muscle_groups.id", ondelete="CASCADE"), nullable=False)
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id", ondelete="RESTRICT"), nullable=False)
    exercise_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    target_sets: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    target_reps: Mapped[str] = mapped_column(String(40), default="12", nullable=False)
    target_weight_kg: Mapped[float | None] = mapped_column(Float)
    rest_seconds: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    schedule_muscle_group: Mapped["ScheduleMuscleGroup"] = relationship(back_populates="exercises")
    exercise: Mapped["Exercise"] = relationship()

class CardioActivity(TimestampMixin, Base):
    """Master data: kinds of planned cardio (kept separate from muscle groups)."""
    __tablename__ = "cardio_activities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

class ScheduleCardio(OwnedMixin, TimestampMixin, Base):
    """Planned cardio on a day (cardio-only days, or alongside strength work)."""
    __tablename__ = "schedule_cardio"
    __table_args__ = (Index("ix_schedule_cardio_daily_schedule_id", "daily_schedule_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    daily_schedule_id: Mapped[int] = mapped_column(ForeignKey("daily_schedules.id", ondelete="CASCADE"), nullable=False)
    cardio_activity_id: Mapped[int] = mapped_column(ForeignKey("cardio_activities.id", ondelete="RESTRICT"), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    distance_km: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    daily_schedule: Mapped["DailySchedule"] = relationship(back_populates="cardio_items")
    cardio_activity: Mapped["CardioActivity"] = relationship()

class BodyMetric(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "body_metrics"
    __table_args__ = (Index("ix_body_metrics_recorded_date", "recorded_date"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recorded_date: Mapped[date] = mapped_column(Date, nullable=False)
    weight_kg: Mapped[float | None] = mapped_column(Float)
    body_fat_percent: Mapped[float | None] = mapped_column(Float)
    chest_cm: Mapped[float | None] = mapped_column(Float)
    waist_cm: Mapped[float | None] = mapped_column(Float)
    hips_cm: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)
