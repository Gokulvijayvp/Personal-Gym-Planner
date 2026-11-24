"""Migration c4e9a7b1d3f2 against throwaway SQLite files (never the dev DB)."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PREV = "b8d4f1a2c6e7"
NOW = "2026-11-18 10:00:00"


def alembic(db: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}"}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env,
                          capture_output=True, text=True, check=True)


def cols(con, table):
    return [r[1] for r in con.execute(f"PRAGMA table_info({table})")]


def seed_old_data(con):
    """Pre-migration schema: cycles with is_active, plus a full plan hanging off one of them."""
    for name, active in (("Active one", 1), ("Idle one", 0)):
        con.execute("INSERT INTO workout_cycles (name,start_date,total_weeks,repeat_cycle,is_active,created_at,updated_at) "
                    "VALUES (?, '2026-11-16', 4, 0, ?, ?, ?)", (name, active, NOW, NOW))
    con.execute("INSERT INTO weekly_plans (cycle_id,week_number,created_at,updated_at) VALUES (1,1,?,?)", (NOW, NOW))
    con.execute("INSERT INTO daily_schedules (weekly_plan_id,day_of_week,status,created_at,updated_at) VALUES (1,0,'planned',?,?)", (NOW, NOW))
    con.execute("INSERT INTO schedule_muscle_groups (daily_schedule_id,muscle_group_id,created_at,updated_at) VALUES (1,1,?,?)", (NOW, NOW))
    con.execute("INSERT INTO exercises (name,muscle_group_id,is_active,created_at,updated_at) VALUES ('Rope',1,1,?,?)", (NOW, NOW))
    con.execute("INSERT INTO schedule_exercises (schedule_muscle_group_id,exercise_id,exercise_order,target_sets,target_reps,created_at,updated_at) "
                "VALUES (1,1,1,3,'10',?,?)", (NOW, NOW))
    con.commit()


def test_upgrade_migrates_status_and_preserves_everything(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_old_data(con)
    con.close()

    alembic(db, "upgrade", "head")

    con = sqlite3.connect(db)
    assert "is_active" not in cols(con, "workout_cycles") and "status" in cols(con, "workout_cycles")
    assert con.execute("SELECT name, status FROM workout_cycles ORDER BY id").fetchall() == [
        ("Active one", "active"), ("Idle one", "draft")]
    # Child rows and the unique-order table survive the table rebuild.
    assert con.execute("SELECT COUNT(*) FROM weekly_plans").fetchone()[0] == 1
    assert con.execute("SELECT exercise_id, exercise_order FROM schedule_exercises").fetchall() == [(1, 1)]
    assert con.execute("SELECT name FROM exercises").fetchall() == [("Rope",)]       # exercise library untouched
    assert con.execute("SELECT COUNT(*) FROM muscle_groups").fetchone()[0] == 11
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    # New master data + table.
    names = [r[0] for r in con.execute("SELECT name FROM cardio_activities ORDER BY sort_order")]
    assert names[:3] == ["Walking", "Running", "Treadmill"] and "Other" in names and len(names) == 11
    assert {"daily_schedule_id", "cardio_activity_id", "duration_minutes", "distance_km", "notes", "sort_order"} <= set(cols(con, "schedule_cardio"))
    # The ScheduleExercise unique constraint is still enforced.
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO schedule_exercises (schedule_muscle_group_id,exercise_id,exercise_order,target_sets,target_reps,created_at,updated_at) "
                    "VALUES (1,1,1,3,'10',?,?)", (NOW, NOW))
    con.close()


def test_idempotent_and_downgrade_round_trip(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_old_data(con)
    con.close()
    alembic(db, "upgrade", "head")
    alembic(db, "upgrade", "head")  # no-op

    con = sqlite3.connect(db)
    con.execute("UPDATE workout_cycles SET status='completed' WHERE name='Idle one'")
    con.commit()
    con.close()

    alembic(db, "downgrade", PREV)
    con = sqlite3.connect(db)
    assert "is_active" in cols(con, "workout_cycles") and "status" not in cols(con, "workout_cycles")
    assert con.execute("SELECT name, is_active FROM workout_cycles ORDER BY id").fetchall() == [("Active one", 1), ("Idle one", 0)]
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "schedule_cardio" not in tables and "cardio_activities" not in tables
    assert con.execute("SELECT exercise_order FROM schedule_exercises").fetchall() == [(1,)]
    con.close()

    alembic(db, "upgrade", "head")  # and forward again
    con = sqlite3.connect(db)
    assert con.execute("SELECT status FROM workout_cycles WHERE name='Active one'").fetchone() == ("active",)
    con.close()
