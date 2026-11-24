"""The same checks on SQLite and on PostgreSQL (run the suite with TEST_DATABASE_URL set to test PostgreSQL).

They prove the two databases end up with the same schema, indexes, constraints and relationships, and that the test helpers
behave the same on both.
"""
import os
import subprocess
import sys

import pytest
from sqlalchemy import inspect, text

from app.db.base import Base
from app.db.session import create_app_engine
from app.models.user import User
from conftest import BACKEND
from dbhelpers import IS_PG, as_text, fk_violations, sync_pg_sequences


def _alembic(db_url, *args):
    env = {**os.environ, "DATABASE_URL": db_url}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True)


def _head() -> str:
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    return ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini"))).get_current_head()


def test_the_database_is_at_the_latest_revision(session_factory):
    with session_factory() as db:
        assert db.execute(text("SELECT version_num FROM alembic_version")).scalar() == _head()


def test_the_real_schema_matches_the_models_with_no_drift(db_url):
    """`alembic check` compares the actual database (tables, columns, indexes, constraints, foreign keys) with the models."""
    r = _alembic(db_url, "check")
    assert r.returncode == 0 and "No new upgrade operations detected" in (r.stdout + r.stderr), (r.stdout + r.stderr)[-800:]


def test_every_model_table_exists_with_its_columns_and_foreign_keys(session_factory):
    with session_factory() as db:
        insp = inspect(db.get_bind())
        have = set(insp.get_table_names()) - {"alembic_version"}
        assert have == set(Base.metadata.tables)
        for t in Base.metadata.sorted_tables:
            assert {c["name"] for c in insp.get_columns(t.name)} == {c.name for c in t.columns}, t.name
            wanted = {(tuple(c.name for c in fk.columns), fk.referred_table.name) for fk in t.foreign_key_constraints}
            real = {(tuple(f["constrained_columns"]), f["referred_table"]) for f in insp.get_foreign_keys(t.name)}
            assert real == wanted, (t.name, real ^ wanted)


def test_every_named_index_in_the_models_exists_including_partial_and_expression_ones(session_factory):
    with session_factory() as db:
        if IS_PG:
            rows = db.execute(text("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'")).fetchall()
        else:
            rows = db.execute(text("SELECT name, COALESCE(sql, '') FROM sqlite_master WHERE type='index'")).fetchall()
        defs = dict(rows)
        wanted = {ix.name for t in Base.metadata.tables.values() for ix in t.indexes if ix.name}
        assert wanted <= set(defs), sorted(wanted - set(defs))
        # "one running workout per person per day" is a PARTIAL unique index, and names are unique per person ignoring case
        partial = defs["ux_workout_sessions_user_one_active_per_date"].lower()
        assert "unique" in partial and "where" in partial and "in_progress" in partial
        names = defs["ux_exercises_user_name_lower"].lower()
        assert "unique" in names and "lower(" in names and "user_id" in names


def test_the_foreign_key_checker_finds_a_broken_relationship_and_is_empty_otherwise(session_factory):
    """The helper that replaces SQLite's PRAGMA foreign_key_check must really detect an orphan, on both databases."""
    with session_factory() as db:
        assert fk_violations(db) == []
        if IS_PG:
            try:
                db.execute(text("SET session_replication_role = replica"))        # lets a test write an orphan (needs a superuser)
            except Exception:
                pytest.skip("this PostgreSQL user may not switch off foreign-key triggers")
        else:
            db.rollback()
            db.execute(text("PRAGMA foreign_keys = OFF"))
        db.execute(text("INSERT INTO exercise_set_items (set_id, catalogue_key, position, user_id) VALUES (999999, 'orphan', 1, NULL)"))
        db.commit()
        found = fk_violations(db)
        assert found and any("exercise_set_items" in str(row) for row in found)
        db.execute(text("DELETE FROM exercise_set_items WHERE catalogue_key = 'orphan'"))
        db.commit()
        if IS_PG:
            db.execute(text("SET session_replication_role = DEFAULT"))
        else:
            db.execute(text("PRAGMA foreign_keys = ON"))
        assert fk_violations(db) == []


def test_a_row_inserted_with_an_explicit_id_does_not_break_the_next_automatic_id(session_factory):
    """PostgreSQL's id counter ignores explicit ids; the helper moves it forward. On SQLite this is a no-op that must still pass."""
    with session_factory() as db:
        db.add(User(id=500, email="explicit@example.com", role="user"))
        db.commit()
        sync_pg_sequences(db)
        db.add(User(email="automatic@example.com", role="user"))
        db.commit()
        newest = db.execute(text("SELECT MAX(id) FROM users")).scalar()
        assert newest > 500


def test_timestamps_read_back_as_text_or_datetime_mean_the_same_thing(session_factory):
    with session_factory() as db:
        db.add(User(email="when@example.com", role="user"))
        db.commit()
        raw = db.execute(text("SELECT created_at FROM users WHERE email='when@example.com'")).scalar()
        assert as_text(raw)[:4].isdigit() and as_text(raw)[4] == "-"          # "2026-..." whichever type the driver returned


def test_the_app_engine_uses_the_right_settings_for_each_database(db_url):
    engine = create_app_engine(db_url)
    try:
        assert engine.dialect.name == ("postgresql" if IS_PG else "sqlite")
        with engine.connect() as c:
            if IS_PG:
                assert engine.pool.size() == 5                                     # a small pool, as RDS micro instances allow few connections
            else:
                assert c.execute(text("PRAGMA foreign_keys")).scalar() == 1        # SQLite enforces relationships only when told to
    finally:
        engine.dispose()


@pytest.mark.parametrize("given,expected", [
    ("postgres://u:p@h:5432/d", "postgresql+psycopg://u:p@h:5432/d"),
    ("postgresql://u:p@h:5432/d?sslmode=require", "postgresql+psycopg://u:p@h:5432/d?sslmode=require"),
    ("postgresql+psycopg://u@h/d", "postgresql+psycopg://u@h/d"),
    ("sqlite:///x.db", "sqlite:///x.db"),
])
def test_database_urls_are_normalised_for_rds_style_spellings(given, expected):
    from app.db.session import normalise_url
    assert normalise_url(given) == expected
