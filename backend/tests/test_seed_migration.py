"""Runs the real Alembic history against a throwaway SQLite file (never the dev DB)."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _alembic(db: Path, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}"}
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, check=True,
                   capture_output=True)


def test_seed_master_data_and_idempotency(tmp_path):
    db = tmp_path / "t.db"
    _alembic(db, "upgrade", "head")
    _alembic(db, "upgrade", "head")  # re-run must not duplicate
    con = sqlite3.connect(db)
    groups = [r[0] for r in con.execute("SELECT name FROM muscle_groups ORDER BY sort_order")]
    types = {r[0] for r in con.execute("SELECT name FROM workout_types")}
    con.close()
    assert groups == ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Forearms",
                      "Abs / Core", "Quadriceps", "Hamstrings", "Glutes", "Calves"]
    assert "Cardio" not in groups
    assert types == {"Barbell", "Dumbbell", "Machine", "Cable", "Bodyweight",
                     "Smith Machine", "Resistance Band", "Other"}


def test_downgrade_removes_only_seed_rows(tmp_path):
    db = tmp_path / "t.db"
    _alembic(db, "upgrade", "head")
    _alembic(db, "downgrade", "d719fa6c863c")
    con = sqlite3.connect(db)
    assert con.execute("SELECT COUNT(*) FROM muscle_groups").fetchone()[0] == 0
    con.close()
