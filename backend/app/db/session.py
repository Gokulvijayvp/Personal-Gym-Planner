from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

if settings.database_url.startswith("sqlite:///"):
    db_path = settings.database_url.replace("sqlite:///", "", 1)
    if db_path != ":memory:" and not db_path.startswith("/"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    elif db_path.startswith("/"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

def normalise_url(url: str) -> str:
    """Accept the usual RDS/Postgres spellings (postgres://, postgresql://) and use the psycopg 3 driver for them."""
    for old in ("postgres://", "postgresql://"):
        if url.startswith(old):
            return "postgresql+psycopg://" + url[len(old):]
    return url


def create_app_engine(url: str):
    """Engine for SQLite (with the project's pragmas: foreign keys ON, WAL, busy timeout) or PostgreSQL (for example AWS RDS)."""
    url = normalise_url(url)
    is_sqlite = url.startswith("sqlite")
    if is_sqlite:
        eng = create_engine(url, connect_args={"check_same_thread": False}, pool_pre_ping=True)
    else:
        # A small pool: the API runs as one process on a small server and RDS micro instances allow few connections.
        # pool_pre_ping drops connections the database closed; pool_recycle renews them before RDS/network idle limits.
        eng = create_engine(url, pool_size=5, max_overflow=5, pool_pre_ping=True, pool_recycle=1800)
    if is_sqlite:
        @event.listens_for(eng, "connect")
        def enable_sqlite_features(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()
    return eng

engine = create_app_engine(settings.database_url)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from app.db import scope  # noqa: E402,F401  (registers the per-user data filter on every session)
