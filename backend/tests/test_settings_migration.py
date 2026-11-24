"""Migration d5a2b8c1e9f3 against throwaway SQLite files (never the dev DB)."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PREV = "c4e9a7b1d3f2"
THIS = "d5a2b8c1e9f3"
NOW = "2026-11-19 10:00:00"


def alembic(db: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}"}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env,
                          capture_output=True, text=True, check=True)


def seed_user_data(con):
    con.execute("INSERT INTO exercises (name,muscle_group_id,is_active,created_at,updated_at) VALUES ('Rope',1,1,?,?)", (NOW, NOW))
    con.execute("INSERT INTO workout_cycles (name,start_date,total_weeks,repeat_cycle,status,created_at,updated_at) "
                "VALUES ('Winter','2026-11-23',4,0,'active',?,?)", (NOW, NOW))
    con.commit()


def user_data(con):
    return (con.execute("SELECT name FROM exercises").fetchall(),
            con.execute("SELECT name, status, start_date FROM workout_cycles").fetchall(),
            con.execute("SELECT COUNT(*) FROM muscle_groups").fetchone())


def test_upgrade_creates_defaults_and_preserves_data(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_user_data(con)
    before = user_data(con)
    con.close()

    alembic(db, "upgrade", THIS)

    con = sqlite3.connect(db)
    assert con.execute("SELECT version_num FROM alembic_version").fetchone() == (THIS,)
    assert user_data(con) == before == ([("Rope",)], [("Winter", "active", "2026-11-23")], (11,))
    assert con.execute(
        "SELECT id, display_name, rest_between_sets_seconds, rest_between_exercises_seconds, target_workout_minutes, "
        "weight_unit, distance_unit, week_start, date_format FROM app_settings").fetchall() == [
        (1, None, 90, 120, 60, "kg", "km", "monday", "DD MMM YYYY")]
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    # Database-level guards.
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO app_settings (id, created_at, updated_at) VALUES (2, ?, ?)", (NOW, NOW))
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("UPDATE app_settings SET target_workout_minutes = 0")
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("UPDATE app_settings SET date_format = 'bad'")
    con.close()


def test_idempotent_and_round_trip_with_user_edits(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_user_data(con)
    con.close()
    alembic(db, "upgrade", THIS)
    alembic(db, "upgrade", THIS)  # no-op

    con = sqlite3.connect(db)
    assert con.execute("SELECT COUNT(*) FROM app_settings").fetchone() == (1,)
    con.execute("UPDATE app_settings SET display_name='Gokul', weight_unit='lbs'")
    con.commit()
    con.close()

    alembic(db, "downgrade", PREV)
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "app_settings" not in tables
    assert con.execute("SELECT version_num FROM alembic_version").fetchone() == (PREV,)
    assert user_data(con) == ([("Rope",)], [("Winter", "active", "2026-11-23")], (11,))
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    con.close()

    alembic(db, "upgrade", THIS)  # forward again: fresh defaults, data intact
    con = sqlite3.connect(db)
    assert con.execute("SELECT display_name, weight_unit FROM app_settings").fetchall() == [(None, "kg")]
    assert user_data(con) == ([("Rope",)], [("Winter", "active", "2026-11-23")], (11,))
    con.close()


def test_models_match_migration(tmp_path):
    """`alembic check` reports no drift between the model and the migration."""
    db = tmp_path / "t.db"
    alembic(db, "upgrade", "head")
    out = alembic(db, "check")
    assert "No new upgrade operations detected" in out.stdout + out.stderr
