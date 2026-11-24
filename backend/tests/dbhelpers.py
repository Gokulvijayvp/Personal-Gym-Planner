"""Helpers that let the same tests run on SQLite (the default) and on PostgreSQL (what AWS RDS runs).

Set TEST_DATABASE_URL=postgresql+psycopg://user@host:port to run the whole suite on PostgreSQL.
"""
import os

import pytest
from sqlalchemy import inspect, text

PG_BASE = (os.environ.get("TEST_DATABASE_URL") or "").rstrip("/")
IS_PG = PG_BASE.startswith("postgres")

# Tests that are about a SQLite file (WAL, PRAGMA, the downloadable .db backup) are SQLite-only on purpose. They are skipped on
# PostgreSQL with this visible reason, and a PostgreSQL counterpart tests what PostgreSQL does instead.
sqlite_only = pytest.mark.skipif(IS_PG, reason="SQLite-only: it is about the SQLite file itself (PostgreSQL has its own test)")
postgres_only = pytest.mark.skipif(not IS_PG, reason="PostgreSQL-only")


def sync_pg_sequences(db) -> None:
    """After rows were inserted with an explicit id (as fixtures do), move each PostgreSQL id counter past the highest id.
    SQLite needs nothing: it always continues from the highest rowid."""
    if not IS_PG:
        return
    from app.db.base import Base
    for t in Base.metadata.sorted_tables:
        if "id" in t.c and t.c.id.primary_key and t.c.id.autoincrement is not False:
            db.execute(text(
                f"SELECT setval(pg_get_serial_sequence('\"{t.name}\"', 'id'), COALESCE((SELECT MAX(id) FROM \"{t.name}\"), 1), "
                f"(SELECT MAX(id) IS NOT NULL FROM \"{t.name}\")) WHERE pg_get_serial_sequence('\"{t.name}\"', 'id') IS NOT NULL"))
    db.commit()


def fk_violations(db) -> list:
    """Rows whose foreign key points at nothing. Empty = every relationship is intact. Works on SQLite and PostgreSQL."""
    bind = db.get_bind()
    if bind.dialect.name == "sqlite":
        return db.execute(text("PRAGMA foreign_key_check")).fetchall()
    insp = inspect(bind)
    bad = []
    for table in insp.get_table_names():
        for fk in insp.get_foreign_keys(table):
            cols, parent, pcols = fk["constrained_columns"], fk["referred_table"], fk["referred_columns"]
            join = " AND ".join(f'c."{a}" = p."{b}"' for a, b in zip(cols, pcols))
            present = " AND ".join(f'c."{a}" IS NOT NULL' for a in cols)
            n = db.execute(text(f'SELECT COUNT(*) FROM "{table}" c LEFT JOIN "{parent}" p ON {join} WHERE {present} AND p."{pcols[0]}" IS NULL')).scalar()
            if n:
                bad.append((table, tuple(cols), parent, n))
    return bad


def as_text(value) -> str:
    """A stored timestamp as text, whether the driver returns a string (SQLite) or a datetime (PostgreSQL)."""
    return str(value)
