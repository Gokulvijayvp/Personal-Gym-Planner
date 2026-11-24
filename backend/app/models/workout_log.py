"""Actual workout records (Phase 9).

Everything here is *independent of the plan*: targets are copied in when a workout starts and are never
written back, and the exercise / activity names are snapshotted so history stays readable if a library
entry is later deactivated or deleted (the foreign keys are SET NULL, never CASCADE).

Weights and distances use fixed-point NUMERIC in canonical units (kg, km); the API converts for display.
"""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.workout import TimestampMixin
from app.models.ownership import OwnedMixin

STATUS_IN_PROGRESS = "in_progress"
_LOG_STATUS = "('pending','completed','skipped')"


class WorkoutSession(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "workout_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('in_progress','completed','cancelled')", name="ck_workout_sessions_status"),
        CheckConstraint("source IN ('plan','blank')", name="ck_workout_sessions_source"),
        # A session is finished exactly when it has an end time.
        CheckConstraint("(status = 'in_progress' AND ended_at IS NULL) OR (status <> 'in_progress' AND ended_at IS NOT NULL)",
                        name="ck_workout_sessions_ended"),
        Index("ix_workout_sessions_workout_date", "workout_date"),
        Index("ix_workout_sessions_status", "status"),
        # At most one unfinished session per calendar day: makes duplicate starts (double taps, two tabs) impossible.
        Index("ux_workout_sessions_user_one_active_per_date", "user_id", "workout_date", unique=True,
              sqlite_where=text("status = 'in_progress'"), postgresql_where=text("status = 'in_progress'")),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    daily_schedule_id: Mapped[int | None] = mapped_column(ForeignKey("daily_schedules.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(5), nullable=False)            # 'plan' | 'blank'
    workout_date: Mapped[date] = mapped_column(Date, nullable=False)          # local (Asia/Kolkata) calendar date
    status: Mapped[str] = mapped_column(String(11), nullable=False, default=STATUS_IN_PROGRESS)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)    # naive UTC
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)               # naive UTC; completion or cancellation time
    title: Mapped[str | None] = mapped_column(String(120))                    # snapshot of the planned day's title
    cycle_name: Mapped[str | None] = mapped_column(String(120))               # snapshots: the plan may later change or go
    week_number: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)                           # overall note (on completion)
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    exercises: Mapped[list["WorkoutSessionExercise"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="WorkoutSessionExercise.position, WorkoutSessionExercise.id")
    cardio: Mapped[list["WorkoutSessionCardio"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="WorkoutSessionCardio.position, WorkoutSessionCardio.id")


class WorkoutSessionExercise(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "workout_session_exercises"
    __table_args__ = (
        CheckConstraint(f"status IN {_LOG_STATUS}", name="ck_wse_status"),
        Index("ix_wse_session_id", "session_id"),
        Index("ix_wse_exercise_id", "exercise_id"),
        Index("ix_wse_exercise_name", "exercise_name"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False)
    exercise_id: Mapped[int | None] = mapped_column(ForeignKey("exercises.id", ondelete="SET NULL"))
    schedule_exercise_id: Mapped[int | None] = mapped_column(ForeignKey("schedule_exercises.id", ondelete="SET NULL"))
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(9), nullable=False, default="pending")
    # --- snapshots (history survives library changes) ---
    exercise_name: Mapped[str] = mapped_column(String(160), nullable=False)
    muscle_group_name: Mapped[str | None] = mapped_column(String(80))
    workout_type_name: Mapped[str | None] = mapped_column(String(80))
    # --- planned targets, copied at start and never edited ---
    target_sets: Mapped[int | None] = mapped_column(Integer)
    target_reps: Mapped[str | None] = mapped_column(String(40))
    target_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(8, 3))
    target_rest_seconds: Mapped[int | None] = mapped_column(Integer)
    plan_notes: Mapped[str | None] = mapped_column(Text)
    # --- actual ---
    notes: Mapped[str | None] = mapped_column(Text)
    session: Mapped["WorkoutSession"] = relationship(back_populates="exercises")
    sets: Mapped[list["WorkoutSessionSet"]] = relationship(
        back_populates="exercise", cascade="all, delete-orphan", order_by="WorkoutSessionSet.set_number")


class WorkoutSessionSet(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "workout_session_sets"
    __table_args__ = (
        UniqueConstraint("session_exercise_id", "set_number", name="uq_wss_exercise_set_number"),
        CheckConstraint(f"status IN {_LOG_STATUS}", name="ck_wss_status"),
        CheckConstraint("set_number >= 1", name="ck_wss_set_number"),
        CheckConstraint("actual_reps IS NULL OR actual_reps BETWEEN 0 AND 1000", name="ck_wss_reps"),
        CheckConstraint("actual_weight_kg IS NULL OR actual_weight_kg BETWEEN 0 AND 1000", name="ck_wss_weight"),
        CheckConstraint("rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 7200", name="ck_wss_rest"),
        Index("ix_wss_session_exercise_id", "session_exercise_id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_exercise_id: Mapped[int] = mapped_column(ForeignKey("workout_session_exercises.id", ondelete="CASCADE"), nullable=False)
    set_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(9), nullable=False, default="pending")
    target_reps: Mapped[str | None] = mapped_column(String(40))
    target_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(8, 3))
    actual_reps: Mapped[int | None] = mapped_column(Integer)
    actual_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(8, 3))   # NULL = bodyweight / not recorded
    rest_seconds: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    exercise: Mapped["WorkoutSessionExercise"] = relationship(back_populates="sets")


class WorkoutSessionCardio(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "workout_session_cardio"
    __table_args__ = (
        CheckConstraint(f"status IN {_LOG_STATUS}", name="ck_wsc_status"),
        CheckConstraint("duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 1440", name="ck_wsc_duration"),
        CheckConstraint("distance_km IS NULL OR distance_km BETWEEN 0 AND 1000", name="ck_wsc_distance"),
        CheckConstraint("calories IS NULL OR calories BETWEEN 0 AND 20000", name="ck_wsc_calories"),
        CheckConstraint("speed_kmh IS NULL OR speed_kmh BETWEEN 0 AND 200", name="ck_wsc_speed"),
        Index("ix_wsc_session_id", "session_id"),
        Index("ix_wsc_cardio_activity_id", "cardio_activity_id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False)
    cardio_activity_id: Mapped[int | None] = mapped_column(ForeignKey("cardio_activities.id", ondelete="SET NULL"))
    schedule_cardio_id: Mapped[int | None] = mapped_column(ForeignKey("schedule_cardio.id", ondelete="SET NULL"))
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(9), nullable=False, default="pending")
    activity_name: Mapped[str] = mapped_column(String(80), nullable=False)    # snapshot
    target_duration_minutes: Mapped[int | None] = mapped_column(Integer)
    target_distance_km: Mapped[Decimal | None] = mapped_column(Numeric(7, 3))
    plan_notes: Mapped[str | None] = mapped_column(Text)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    distance_km: Mapped[Decimal | None] = mapped_column(Numeric(7, 3))
    calories: Mapped[int | None] = mapped_column(Integer)                     # manual entry only, never calculated
    speed_kmh: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    resistance: Mapped[str | None] = mapped_column(String(40))
    notes: Mapped[str | None] = mapped_column(Text)
    session: Mapped["WorkoutSession"] = relationship(back_populates="cardio")
