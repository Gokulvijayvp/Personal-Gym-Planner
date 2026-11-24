"""Application preferences (one row per user) and data-management helpers."""
import os
import sqlite3
import tempfile
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings as app_config
from app.core.errors import AppError
from app.models import AppSettings, DailySchedule, Exercise, WorkoutCycle, WorkoutSession
from app.schemas.app_settings import DataCounts, DataInfo, ResetSection, SettingsInput

DEFAULTS: dict[str, object] = {
    "display_name": None,
    "rest_between_sets_seconds": 90,
    "rest_between_exercises_seconds": 120,
    "target_workout_minutes": 60,
    "weight_unit": "kg",
    "distance_unit": "km",
    "week_start": "monday",
    "date_format": "DD MMM YYYY",
}

SECTION_FIELDS: dict[str, tuple[str, ...]] = {
    "workout": ("rest_between_sets_seconds", "rest_between_exercises_seconds", "target_workout_minutes",
                "weight_unit", "distance_unit"),
    "calendar": ("week_start", "date_format"),
    "personal": ("display_name",),
}
SECTION_FIELDS["all"] = tuple(f for fields in list(SECTION_FIELDS.values()) for f in fields)


def get_settings(db: Session) -> AppSettings:
    """This user's settings row (the data filter finds the right one). A new user gets the defaults on first use."""
    row = db.scalar(select(AppSettings))
    if row is not None:
        return row
    try:
        next_id = db.scalar(select(func.coalesce(func.max(AppSettings.id), 0) + 1).execution_options(unscoped=True))
        row = AppSettings(id=next_id, **DEFAULTS)
        db.add(row)
        db.commit()
    except IntegrityError:  # a concurrent request created it first
        db.rollback()
        row = db.scalar(select(AppSettings))
        if row is None:
            raise
    return row


def update_settings(db: Session, payload: SettingsInput) -> AppSettings:
    row = get_settings(db)
    try:
        for field, value in payload.model_dump().items():
            setattr(row, field, value)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(row)
    return row


def reset_settings(db: Session, section: ResetSection) -> AppSettings:
    row = get_settings(db)
    try:
        for field in SECTION_FIELDS[section]:
            setattr(row, field, DEFAULTS[field])
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(row)
    return row


# ---- data management -------------------------------------------------------------------------

BACKUP_INCLUDES = [
    "Exercise Library (including your own exercises)",
    "Workout Cycles, weeks and daily plans",
    "Planned exercises, sets, reps and cardio",
    "Any workout and body-metric records stored in the database",
    "These settings",
]


def _is_sqlite(db: Session) -> bool:
    return db.get_bind().dialect.name == "sqlite"


def _engine_name(db: Session) -> str:
    return {"sqlite": "SQLite", "postgresql": "PostgreSQL"}.get(db.get_bind().dialect.name, db.get_bind().dialect.name)


def data_info(db: Session, include_server: bool = False) -> DataInfo:
    """The caller's own counts always; the server facts only when `include_server` (the route passes True for the Admin only)."""
    def count(model) -> int:
        return int(db.scalar(select(func.count()).select_from(model)) or 0)

    counts = DataCounts(exercises=count(Exercise), cycles=count(WorkoutCycle),
                        planned_days=count(DailySchedule), workout_sessions=count(WorkoutSession))
    if not include_server:
        return DataInfo(counts=counts)
    size = None
    if _is_sqlite(db):
        pages = db.execute(text("PRAGMA page_count")).scalar()
        page_size = db.execute(text("PRAGMA page_size")).scalar()
        size = int(pages) * int(page_size) if pages is not None and page_size is not None else None
    elif db.get_bind().dialect.name == "postgresql":
        size = db.execute(text("SELECT pg_database_size(current_database())")).scalar()
    try:
        version = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:
        db.rollback()
        version = None

    engine_name = _engine_name(db)
    return DataInfo(
        application=app_config.app_name, api_version="0.1.0", environment=app_config.app_env,
        timezone=app_config.timezone, database_engine=engine_name,
        schema_version=version, database_size_bytes=size,
        counts=counts,
        backup_includes=BACKUP_INCLUDES,
    )


def create_backup_file(db: Session) -> Path:
    """Consistent snapshot of the whole database in a temp file (the caller deletes it after sending).

    Uses SQLite's online backup API, so changes still sitting in the WAL are included and a
    concurrent write cannot corrupt the copy. A plain file copy would miss them.
    """
    if not _is_sqlite(db):
        raise AppError(400, "This server uses a managed database (AWS RDS). Its backups are automatic: use the RDS automated backups "
                            "and snapshots in the AWS console.", code="backup_unsupported")
    source = db.connection().connection.driver_connection
    fd, name = tempfile.mkstemp(prefix="gym-planner-backup-", suffix=".db")
    os.close(fd)
    target_path = Path(name)
    target = sqlite3.connect(name)
    try:
        source.backup(target)
        target.execute("PRAGMA journal_mode=DELETE")  # self-contained single file, no -wal sidecar
        target.commit()
    except Exception:
        target.close()
        target_path.unlink(missing_ok=True)
        raise
    target.close()
    return target_path
