import sqlite3

from sqlalchemy import text
import subprocess
import sys

import pytest

from app.core.exercise_motion import MOTIONS, guess_motion
from tests.conftest import BACKEND
from tests.test_exercises_api import create, payload

URL = "/api/v1/exercise-masters"


# ---- guess_motion -------------------------------------------------------------------------

@pytest.mark.parametrize("name,group,expected", [
    ("Barbell Bench Press", "Chest", "benchpress"),
    ("Push-ups", "Chest", "pushup"),
    ("Dumbbell Bicep Curl", "Biceps", "curl"),
    ("Back Squat", "Quadriceps", "squat"),
    ("Bulgarian Split Squat", None, "lunge"),
    ("Walking Lunges", None, "lunge"),
    ("Seated Cable Row", "Back", "row"),
    ("Lat Pulldown", "Back", "pullup"),
    ("Pull-Up", None, "pullup"),
    ("Lateral Raise", "Shoulders", "raise"),
    ("Romanian Deadlift", "Hamstrings", "deadlift"),
    ("Plank", "Abs / Core", "plank"),
    ("Crunch", None, "crunch"),
    ("Treadmill Run", None, "cardio"),
    ("Rope", "Chest", "press"),          # nothing in the name: falls back to the muscle group
    ("Rope", None, "generic"),
    ("Mystery Move", "Unknown Group", "generic"),
    ("Incline Dumbbell Press", None, "incline"), ("Decline Bench Press", None, "decline"), ("Cable Crossover", None, "fly"),
    ("Chest Dips", None, "dip"), ("Rope Pushdown", None, "pushdown"), ("Skull Crushers", None, "extension"),
    ("Seated Calf Raise", None, "calfraise"), ("Leg Extension", None, "legext"), ("Lying Leg Curl", None, "legcurl"),
    ("Barbell Hip Thrust", None, "bridge"), ("Russian Twist", None, "twist"), ("Hanging Leg Raise", None, "legraise"),
    ("Dumbbell Shrugs", None, "shrug"), ("Farmer's Walk", None, "carry"), ("Leg Press", None, "squat"),
])
def test_guess_motion(name, group, expected):
    assert guess_motion(name, group) == expected
    assert expected in MOTIONS


# ---- API ----------------------------------------------------------------------------------

def test_list_includes_motions_and_empty_start(client):
    body = client.get(URL).json()
    assert body["items"] == []
    assert set(body["motions"]) == set(MOTIONS)


def test_create_guesses_icon_and_lists_sorted(client):
    r = client.post(URL, json={"name": "Hammer Curl"})
    assert r.status_code == 201
    assert r.json()["icon_motion"] == "curl" and r.json()["usage_count"] == 0
    client.post(URL, json={"name": "arnold press", "icon_motion": "raise"})
    names = [m["name"] for m in client.get(URL).json()["items"]]
    assert names == ["arnold press", "Hammer Curl"]


def test_create_rejects_duplicates_any_case_and_bad_input(client):
    assert client.post(URL, json={"name": "Row"}).status_code == 201
    r = client.post(URL, json={"name": "  ROW "})
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_name"
    assert client.post(URL, json={"name": "x"}).status_code == 422
    assert client.post(URL, json={"name": "Valid", "icon_motion": "flying"}).status_code == 422
    assert client.post(URL, json={"name": "Valid", "surprise": 1}).status_code == 422


def test_update_changes_icon_and_keeps_it_when_omitted(client):
    m = client.post(URL, json={"name": "Cable Row", "icon_motion": "row"}).json()
    r = client.put(f"{URL}/{m['id']}", json={"name": "Cable Row", "icon_motion": "pullup"})
    assert r.status_code == 200 and r.json()["icon_motion"] == "pullup"
    r = client.put(f"{URL}/{m['id']}", json={"name": "Cable Row Wide"})
    assert r.json()["icon_motion"] == "pullup" and r.json()["name"] == "Cable Row Wide"
    assert client.put(f"{URL}/9999", json={"name": "Nope"}).status_code == 404


def test_update_rejects_name_of_another_master(client):
    client.post(URL, json={"name": "Alpha"})
    b = client.post(URL, json={"name": "Beta"}).json()
    assert client.put(f"{URL}/{b['id']}", json={"name": "alpha"}).status_code == 409


# ---- linking with the Library --------------------------------------------------------------

def test_library_create_creates_and_links_master(client, ref):
    ex = create(client, ref, name="Incline Dumbbell Press")
    assert ex["exercise_master"]["name"] == "Incline Dumbbell Press"
    assert ex["exercise_master"]["icon_motion"] == "incline"
    masters = client.get(URL).json()["items"]
    assert [(m["name"], m["usage_count"]) for m in masters] == [("Incline Dumbbell Press", 1)]


def test_library_create_reuses_existing_master_ignoring_case(client, ref):
    m = client.post(URL, json={"name": "Cable Fly", "icon_motion": "raise"}).json()
    ex = create(client, ref, name="cable fly")
    assert ex["exercise_master"]["id"] == m["id"] and ex["exercise_master"]["icon_motion"] == "raise"
    assert len(client.get(URL).json()["items"]) == 1


def test_library_rename_relinks_to_other_master(client, ref):
    ex = create(client, ref, name="Bench Press")
    r = client.put(f"/api/v1/exercises/{ex['id']}", json=payload(ref, name="Close Grip Bench Press"))
    assert r.json()["exercise_master"]["name"] == "Close Grip Bench Press"
    items = {m["name"]: m["usage_count"] for m in client.get(URL).json()["items"]}
    assert items == {"Bench Press": 0, "Close Grip Bench Press": 1}


def test_master_rename_cascades_to_library_exercise(client, ref):
    ex = create(client, ref, name="Bench Press")
    mid = ex["exercise_master"]["id"]
    assert client.put(f"{URL}/{mid}", json={"name": "Flat Bench Press"}).status_code == 200
    got = client.get(f"/api/v1/exercises/{ex['id']}").json()
    assert got["name"] == "Flat Bench Press" and got["exercise_master"]["name"] == "Flat Bench Press"


def test_master_rename_blocked_by_unlinked_library_name(client, ref, session_factory):
    ex = create(client, ref, name="Bench Press")
    other = create(client, ref, name="Chest Press")
    # Point the second library exercise at the first master so a rename of the *second* master would clash.
    m_other = other["exercise_master"]["id"]
    r = client.put(f"{URL}/{m_other}", json={"name": "bench press"})
    assert r.status_code == 409
    assert client.get(f"/api/v1/exercises/{ex['id']}").json()["name"] == "Bench Press"


def test_delete_master_blocked_while_linked_then_allowed(client, ref):
    ex = create(client, ref, name="Bench Press")
    mid = ex["exercise_master"]["id"]
    r = client.delete(f"{URL}/{mid}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "exercise_master_in_use"
    assert client.delete(f"/api/v1/exercises/{ex['id']}").status_code == 204
    assert client.delete(f"{URL}/{mid}").status_code == 204
    assert client.delete(f"{URL}/{mid}").status_code == 404


def test_deleting_master_row_directly_nulls_the_link(client, ref, session_factory):
    """The database itself (ON DELETE SET NULL), not the API, keeps the exercise when its master row disappears."""
    ex = create(client, ref, name="Bench Press")
    with session_factory() as db:
        db.execute(text("DELETE FROM exercise_masters"))
        db.commit()
    got = client.get(f"/api/v1/exercises/{ex['id']}").json()
    assert got["exercise_master"] is None and got["name"] == "Bench Press"


# ---- migration ----------------------------------------------------------------------------

def test_migration_backfills_and_round_trips(tmp_path):
    import os
    db = tmp_path / "m.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}"}

    def alembic(*args):
        return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env,
                              check=True, capture_output=True, text=True)

    alembic("upgrade", "e6b3c9d2f7a4")
    con = sqlite3.connect(db)
    group = con.execute("SELECT id FROM muscle_groups WHERE name='Biceps'").fetchone()[0]
    for n in ("Hammer Curl", "Rope", "Bench Press"):
        con.execute("INSERT INTO exercises(name,muscle_group_id,is_active,created_at,updated_at) "
                    "VALUES (?,?,1,'2026-01-01','2026-01-01')", (n, group))
    con.commit()
    con.close()

    alembic("upgrade", "head")
    con = sqlite3.connect(db)
    rows = dict(con.execute("SELECT e.name, m.icon_motion FROM exercises e JOIN exercise_masters m "
                            "ON m.id = e.exercise_master_id").fetchall())
    assert rows == {"Hammer Curl": "curl", "Rope": "curl", "Bench Press": "press"}
    indexes = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert {"ux_exercises_user_name_lower", "ux_exercise_masters_name_lower"} <= indexes
    con.close()
    assert "No new upgrade operations" in (alembic("check").stdout + alembic("check").stderr)

    alembic("downgrade", "e6b3c9d2f7a4")
    con = sqlite3.connect(db)
    assert con.execute("SELECT COUNT(*) FROM exercises").fetchone()[0] == 3
    assert "exercise_masters" not in {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    assert "ux_exercises_name_lower" in {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    con.close()
    alembic("upgrade", "head")


def test_guess_endpoint_matches_what_saving_picks(client):
    r = client.get(URL + "/guess", params={"name": "Cable Crossover or Pec Fly"})
    assert r.status_code == 200 and r.json()["icon_motion"] == "fly"
    assert client.get(URL + "/guess", params={"name": "Walking Lunges"}).json()["icon_motion"] == "lunge"
    assert client.get(URL + "/guess").json()["icon_motion"] == "generic"
    saved = client.post(URL, json={"name": "Cable Crossover or Pec Fly"}).json()
    assert saved["icon_motion"] == "fly"
