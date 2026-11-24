"""Migration b8d4f1a2c6e7 against throwaway SQLite files (never the dev DB)."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PREV = "a3c5e7f91b24"
NOW = "2026-11-18 10:00:00"


def alembic(db: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}"}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env,
                          capture_output=True, text=True, check=check)


def cols(con, table):
    return [r[1] for r in con.execute(f"PRAGMA table_info({table})")]


def seed_old_exercises(con, rows):
    """rows: (name, muscle_group_name, target_area_text)"""
    for name, group, area in rows:
        gid = con.execute("SELECT id FROM muscle_groups WHERE name=?", (group,)).fetchone()[0]
        con.execute(
            "INSERT INTO exercises (name, muscle_group_id, target_area, is_active, created_at, updated_at) "
            "VALUES (?,?,?,1,?,?)", (name, gid, area, NOW, NOW))
    con.commit()


def test_upgrade_preserves_data_and_maps_target_area(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_old_exercises(con, [("Barbell Bench Press", "Chest", "middle chest"),
                             ("Squat", "Quadriceps", None)])
    # A schedule row that references an exercise (FK RESTRICT) must survive the table rebuild.
    con.execute("INSERT INTO workout_cycles (name,start_date,total_weeks,repeat_cycle,is_active,created_at,updated_at) VALUES ('c','2026-11-16',4,0,1,?,?)", (NOW, NOW))
    con.execute("INSERT INTO weekly_plans (cycle_id,week_number,created_at,updated_at) VALUES (1,1,?,?)", (NOW, NOW))
    con.execute("INSERT INTO daily_schedules (weekly_plan_id,day_of_week,status,created_at,updated_at) VALUES (1,0,'planned',?,?)", (NOW, NOW))
    con.execute("INSERT INTO schedule_muscle_groups (daily_schedule_id,muscle_group_id,created_at,updated_at) VALUES (1,1,?,?)", (NOW, NOW))
    con.execute("INSERT INTO schedule_exercises (schedule_muscle_group_id,exercise_id,exercise_order,target_sets,target_reps,created_at,updated_at) VALUES (1,1,1,3,'10',?,?)", (NOW, NOW))
    con.commit()
    con.close()

    alembic(db, "upgrade", "head")

    con = sqlite3.connect(db)
    assert "target_area" not in cols(con, "exercises")
    assert {"description", "target_area_id"} <= set(cols(con, "exercises"))
    row = con.execute(
        "SELECT e.name, ta.name FROM exercises e LEFT JOIN target_areas ta ON ta.id=e.target_area_id ORDER BY e.id").fetchall()
    assert row == [("Barbell Bench Press", "Middle Chest"), ("Squat", None)]
    assert con.execute("SELECT exercise_id FROM schedule_exercises").fetchall() == [(1,)]
    assert con.execute("SELECT COUNT(*) FROM muscle_groups").fetchone()[0] == 11  # not duplicated
    # Seeded target areas, grouped correctly.
    areas = dict(con.execute(
        "SELECT g.name, GROUP_CONCAT(t.name, '|') FROM target_areas t JOIN muscle_groups g ON g.id=t.muscle_group_id "
        "GROUP BY g.name").fetchall())
    assert set(areas["Chest"].split("|")) == {"Upper Chest", "Middle Chest", "Lower Chest", "Inner Chest"}
    assert set(areas["Back"].split("|")) == {"Upper Back", "Middle Back", "Lower Back", "Lats"}
    assert set(areas["Shoulders"].split("|")) == {"Front Delts", "Side Delts", "Rear Delts"}
    assert set(areas["Abs / Core"].split("|")) == {"Upper Abs", "Lower Abs", "Obliques"}
    assert areas["Calves"] == "Calves" and areas["Biceps"] == "Biceps"
    # Case-insensitive uniqueness is enforced by the DB itself, per user (two people may both own "Bench Press").
    now = NOW
    con.execute("INSERT INTO users (id, email, role, created_at, updated_at) VALUES (1, 'a@example.com', 'user', ?, ?)", (now, now))
    con.execute("INSERT INTO exercises (name, muscle_group_id, is_active, user_id, created_at, updated_at) VALUES ('Cable Fly',1,1,1,?,?)", (now, now))
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO exercises (name, muscle_group_id, is_active, user_id, created_at, updated_at) VALUES ('CABLE fly',1,1,1,?,?)", (now, now))
    # Existing indexes survived the rebuild.
    idx = {r[1] for r in con.execute("PRAGMA index_list(exercises)")}
    assert {"ix_exercises_muscle_group_id", "ix_exercises_target_area_id", "ux_exercises_user_name_lower"} <= idx
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    con.close()


def test_upgrade_is_idempotent_and_downgrade_round_trips(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_old_exercises(con, [("Cable Fly", "Chest", "Inner Chest")])
    con.close()

    alembic(db, "upgrade", "head")
    alembic(db, "upgrade", "head")  # second run is a no-op

    # Add data using the NEW schema, then downgrade: old data must come back.
    con = sqlite3.connect(db)
    con.execute("INSERT INTO exercises (name, muscle_group_id, target_area_id, is_active, created_at, updated_at) "
                "VALUES ('Lat Pulldown', 2, (SELECT id FROM target_areas WHERE name='Lats'), 1, ?, ?)", (NOW, NOW))
    con.commit()
    con.close()

    alembic(db, "downgrade", PREV)
    con = sqlite3.connect(db)
    assert "target_area" in cols(con, "exercises") and "description" not in cols(con, "exercises")
    assert con.execute("SELECT name, target_area FROM exercises ORDER BY id").fetchall() == [
        ("Cable Fly", "Inner Chest"), ("Lat Pulldown", "Lats")]
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "target_areas" not in tables and "exercise_secondary_muscle_groups" not in tables
    assert con.execute("SELECT COUNT(*) FROM muscle_groups").fetchone()[0] == 11
    con.close()

    alembic(db, "upgrade", "head")  # and forward again
    con = sqlite3.connect(db)
    assert con.execute("SELECT COUNT(*) FROM exercises").fetchone()[0] == 2
    con.close()


def test_duplicate_names_abort_before_any_change(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_old_exercises(con, [("Push Up", "Chest", None), ("push up", "Chest", None)])
    con.close()
    result = alembic(db, "upgrade", "head", check=False)
    assert result.returncode != 0 and "duplicates" in result.stderr
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "target_areas" not in tables                      # nothing half-applied
    assert "target_area" in cols(con, "exercises")
    assert con.execute("SELECT version_num FROM alembic_version").fetchone()[0] == PREV
    con.close()


def test_unmappable_target_area_aborts_before_any_change(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_old_exercises(con, [("Weird", "Chest", "Left Elbow")])
    con.close()
    result = alembic(db, "upgrade", "head", check=False)
    assert result.returncode != 0 and "Left Elbow" in result.stderr
    con = sqlite3.connect(db)
    assert "target_area" in cols(con, "exercises")
    assert con.execute("SELECT target_area FROM exercises").fetchone() == ("Left Elbow",)  # data untouched
    con.close()
