"""Migration e6b3c9d2f7a4 against throwaway SQLite files (never the dev DB)."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PREV = "d5a2b8c1e9f3"
THIS = "e6b3c9d2f7a4"
NOW = "2026-11-19 10:00:00"
NEW_TABLES = {"workout_sessions", "workout_session_exercises", "workout_session_sets", "workout_session_cardio"}
LEGACY_ONLY = {"workout_set_logs", "cardio_logs"}


def alembic(db: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}"}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True, check=True)


def tables(con):
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def seed_user_data(con):
    con.execute("INSERT INTO exercises (name,muscle_group_id,is_active,created_at,updated_at) VALUES ('Rope',1,1,?,?)", (NOW, NOW))
    con.execute("INSERT INTO workout_cycles (name,start_date,total_weeks,repeat_cycle,status,created_at,updated_at) "
                "VALUES ('Winter','2026-11-23',4,0,'active',?,?)", (NOW, NOW))
    con.execute("UPDATE app_settings SET display_name='Gokul', weight_unit='lbs'")
    con.commit()


def user_data(con):
    return (con.execute("SELECT name FROM exercises").fetchall(),
            con.execute("SELECT name, status, start_date FROM workout_cycles").fetchall(),
            con.execute("SELECT display_name, weight_unit FROM app_settings").fetchall(),
            con.execute("SELECT COUNT(*) FROM muscle_groups").fetchone())


EXPECTED_USER = ([("Rope",)], [("Winter", "active", "2026-11-23")], [("Gokul", "lbs")], (11,))


def test_upgrade_replaces_the_empty_placeholders_and_keeps_user_data(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_user_data(con)
    assert {"workout_sessions", "workout_set_logs", "cardio_logs"} <= tables(con)
    con.close()

    alembic(db, "upgrade", THIS)

    con = sqlite3.connect(db)
    t = tables(con)
    assert NEW_TABLES <= t and not (LEGACY_ONLY & t)
    assert user_data(con) == EXPECTED_USER
    assert con.execute("SELECT version_num FROM alembic_version").fetchone() == (THIS,)
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    idx = {r[1]: r[2] for r in con.execute("SELECT * FROM pragma_index_list('workout_sessions')")}
    assert {"ix_workout_sessions_workout_date", "ix_workout_sessions_status", "ux_workout_sessions_one_active_per_date"} <= set(idx)
    assert idx["ux_workout_sessions_one_active_per_date"] == 1                                       # unique
    assert "WHERE status = 'in_progress'" in con.execute("SELECT sql FROM sqlite_master WHERE name='ux_workout_sessions_one_active_per_date'").fetchone()[0]
    names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert {"ix_wse_exercise_id", "ix_wse_exercise_name", "ix_wse_session_id", "ix_wss_session_exercise_id", "ix_wsc_session_id"} <= names
    con.close()


def test_upgrade_is_idempotent_and_matches_the_models(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", "head")
    alembic(db, "upgrade", "head")
    out = alembic(db, "check")
    assert "No new upgrade operations detected" in out.stdout + out.stderr


def insert_legacy(con):
    """Rows the Phase 1 tables could hold: they must survive the upgrade."""
    con.execute("INSERT INTO workout_sessions (id,workout_date,status,started_at,completed_at,notes,created_at,updated_at) VALUES "
                "(1,'2026-11-10','completed','2026-11-10 05:00:00','2026-11-10 06:00:00','Good',?,?),"
                "(2,'2026-11-11','skipped','2026-11-11 05:00:00','2026-11-11 05:10:00',NULL,?,?),"
                "(3,'2026-11-12','in_progress','2026-11-12 05:00:00',NULL,NULL,?,?),"
                "(4,'2026-11-12','in_progress','2026-11-12 07:00:00',NULL,NULL,?,?)", (NOW,) * 8)
    for n, (reps, weight, st) in enumerate([(10, 20.0, "completed"), (8, 22.5, "completed"), (None, None, "skipped")], start=1):
        con.execute("INSERT INTO workout_set_logs (session_id,exercise_id,exercise_name_snapshot,set_number,target_reps,actual_reps,"
                    "target_weight_kg,actual_weight_kg,status,created_at,updated_at) VALUES (1,NULL,'Bench Press',?, '12',?,20.0,?,?,?,?)",
                    (n, reps, weight, st, NOW, NOW))
    con.execute("INSERT INTO workout_set_logs (session_id,exercise_id,exercise_name_snapshot,set_number,actual_reps,status,created_at,updated_at) "
                "VALUES (1,NULL,'Cable Fly',1,12,'completed',?,?)", (NOW, NOW))
    con.execute("INSERT INTO cardio_logs (session_id,activity_name,duration_minutes,distance_km,average_speed,calories,activity_date,created_at,updated_at) "
                "VALUES (1,'Running',20,3.5,10.5,200,'2026-11-10',?,?)", (NOW, NOW))
    con.execute("INSERT INTO cardio_logs (session_id,activity_name,duration_minutes,activity_date,created_at,updated_at) "
                "VALUES (NULL,'Walking',30,'2026-11-09',?,?)", (NOW, NOW))
    con.commit()


def test_upgrade_converts_legacy_rows_if_there_are_any(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", PREV)
    con = sqlite3.connect(db)
    seed_user_data(con)
    insert_legacy(con)
    con.close()
    alembic(db, "upgrade", THIS)

    con = sqlite3.connect(db)
    s = {r[0]: r[1:] for r in con.execute("SELECT id, status, source, ended_at, cancel_reason, notes FROM workout_sessions")}
    assert s[1][:2] == ("completed", "blank") and s[1][2] == "2026-11-10 06:00:00" and s[1][4] == "Good"
    assert s[2][0] == "cancelled"                                                           # 'skipped' -> 'cancelled'
    assert s[3][0] == "in_progress" and s[3][2] is None
    assert s[4][0] == "cancelled" and "duplicate" in s[4][3]                                # only one unfinished session per date
    ex = con.execute("SELECT id, session_id, position, exercise_name, status FROM workout_session_exercises ORDER BY id").fetchall()
    assert [(e[1], e[2], e[3], e[4]) for e in ex] == [(1, 1, "Bench Press", "pending"), (1, 2, "Cable Fly", "completed")]
    sets = con.execute("SELECT set_number, status, target_reps, actual_reps, actual_weight_kg FROM workout_session_sets "
                       "WHERE session_exercise_id=? ORDER BY set_number", (ex[0][0],)).fetchall()
    assert sets == [(1, "completed", "12", 10, 20.0), (2, "completed", "12", 8, 22.5), (3, "skipped", "12", None, None)]
    cardio = con.execute("SELECT activity_name, duration_minutes, distance_km, speed_kmh, calories, status, session_id FROM workout_session_cardio ORDER BY id").fetchall()
    assert cardio[0] == ("Running", 20, 3.5, 10.5, 200, "completed", 1)
    assert cardio[1][0] == "Walking" and cardio[1][1] == 30 and cardio[1][6] not in (None, 1, 2, 3, 4)        # stand-alone cardio got its own session
    assert con.execute("SELECT status, workout_date FROM workout_sessions WHERE id=?", (cardio[1][6],)).fetchone() == ("completed", "2026-11-09")
    assert user_data(con) == EXPECTED_USER
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    con.close()


def insert_new_data(con):
    con.execute("INSERT INTO workout_sessions (id,daily_schedule_id,source,workout_date,status,started_at,ended_at,title,cycle_name,week_number,notes,cancel_reason,created_at,updated_at) VALUES "
                "(1,NULL,'blank','2026-11-18','completed','2026-11-18 05:00:00','2026-11-18 06:15:00','Push day','Winter',1,'Strong',NULL,?,?),"
                "(2,NULL,'blank','2026-11-17','cancelled','2026-11-17 05:00:00','2026-11-17 05:05:00',NULL,NULL,NULL,NULL,'Felt unwell',?,?),"
                "(3,NULL,'blank','2026-11-19','in_progress','2026-11-19 05:00:00',NULL,NULL,NULL,NULL,NULL,NULL,?,?)", (NOW,) * 6)
    con.execute("INSERT INTO workout_session_exercises (id,session_id,exercise_id,position,status,exercise_name,muscle_group_name,target_sets,target_reps,target_weight_kg,notes,created_at,updated_at) VALUES "
                "(1,1,NULL,1,'completed','Bench Press','Chest',3,'12',20.0,'Paused',?,?),(2,1,NULL,2,'skipped','Cable Fly','Chest',NULL,NULL,NULL,NULL,?,?)", (NOW,) * 4)
    for n, (reps, kg, st) in enumerate([(12, 20.0, "completed"), (10, 22.5, "completed"), (8, 22.5, "completed")], start=1):
        con.execute("INSERT INTO workout_session_sets (session_exercise_id,set_number,status,target_reps,target_weight_kg,actual_reps,actual_weight_kg,rest_seconds,notes,created_at,updated_at) "
                    "VALUES (1,?,?,'12',20.0,?,?,90,'ok',?,?)", (n, st, reps, kg, NOW, NOW))
    con.execute("INSERT INTO workout_session_cardio (session_id,position,status,activity_name,target_duration_minutes,duration_minutes,distance_km,calories,speed_kmh,resistance,notes,created_at,updated_at) "
                "VALUES (1,1,'completed','Running',30,28,4.75,310,10.2,'Level 3','Nice',?,?)", (NOW, NOW))
    con.commit()


def test_downgrade_keeps_the_logged_data_and_a_round_trip_restores_it(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", THIS)
    con = sqlite3.connect(db)
    seed_user_data(con)
    insert_new_data(con)
    con.close()

    alembic(db, "downgrade", PREV)

    con = sqlite3.connect(db)
    t = tables(con)
    assert {"workout_sessions", "workout_set_logs", "cardio_logs"} <= t and not (t & {"workout_session_exercises", "workout_session_sets", "workout_session_cardio"})
    assert con.execute("SELECT version_num FROM alembic_version").fetchone() == (PREV,)
    assert [r for r in con.execute("SELECT id, status, completed_at FROM workout_sessions ORDER BY id")] == [
        (1, "completed", "2026-11-18 06:15:00"), (2, "skipped", "2026-11-17 05:05:00"), (3, "in_progress", None)]
    assert con.execute("SELECT notes FROM workout_sessions WHERE id=2").fetchone()[0] == "Cancelled: Felt unwell"
    assert con.execute("SELECT exercise_name_snapshot, set_number, actual_reps, actual_weight_kg, status FROM workout_set_logs ORDER BY set_number").fetchall() == [
        ("Bench Press", 1, 12, 20.0, "completed"), ("Bench Press", 2, 10, 22.5, "completed"), ("Bench Press", 3, 8, 22.5, "completed")]
    assert con.execute("SELECT activity_name, duration_minutes, distance_km, average_speed, calories, activity_date FROM cardio_logs").fetchall() == [
        ("Running", 28, 4.75, 10.2, 310, "2026-11-18")]
    assert user_data(con) == EXPECTED_USER
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    con.close()

    alembic(db, "upgrade", THIS)                                                  # and forward again

    con = sqlite3.connect(db)
    assert user_data(con) == EXPECTED_USER
    assert con.execute("SELECT id, status, source FROM workout_sessions ORDER BY id").fetchall() == [
        (1, "completed", "blank"), (2, "cancelled", "blank"), (3, "in_progress", "blank")]
    ex = con.execute("SELECT exercise_name, status FROM workout_session_exercises ORDER BY id").fetchall()
    assert ex == [("Bench Press", "completed")]                                   # exercise-level extras and set-less exercises are legacy-lossy
    assert con.execute("SELECT set_number, actual_reps, actual_weight_kg FROM workout_session_sets ORDER BY set_number").fetchall() == [(1, 12, 20.0), (2, 10, 22.5), (3, 8, 22.5)]
    assert con.execute("SELECT activity_name, duration_minutes, distance_km, speed_kmh, calories FROM workout_session_cardio").fetchall() == [("Running", 28, 4.75, 10.2, 310)]
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    con.close()


def test_database_constraints_exist_after_upgrade(tmp_path):
    db = tmp_path / "t.db"
    alembic(db, "upgrade", THIS)
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("INSERT INTO workout_sessions (source,workout_date,status,started_at,created_at,updated_at) VALUES ('blank','2026-11-19','in_progress',?,?,?)", (NOW, NOW, NOW))
    for sql in (
        "INSERT INTO workout_sessions (source,workout_date,status,started_at,created_at,updated_at) VALUES ('blank','2026-11-19','in_progress','x','x','x')",   # second unfinished, same day
        "INSERT INTO workout_sessions (source,workout_date,status,started_at,created_at,updated_at) VALUES ('blank','2026-11-20','completed','x','x','x')",     # finished without end time
        "INSERT INTO workout_sessions (source,workout_date,status,started_at,ended_at,created_at,updated_at) VALUES ('nope','2026-11-20','completed','x','x','x','x')",
        "INSERT INTO workout_session_exercises (session_id,position,status,exercise_name,created_at,updated_at) VALUES (999,1,'pending','x','x','x')",
    ):
        with pytest.raises(sqlite3.IntegrityError):
            con.execute(sql)
    con.close()
