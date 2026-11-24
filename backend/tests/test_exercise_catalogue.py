import sqlite3
import subprocess
import sys

from app.core.exercise_catalogue import ENTRIES
from app.core.exercise_motion import DOWNGRADE_MAP, MOTIONS, ORIGINAL_MOTIONS
from tests.conftest import BACKEND
from tests.test_exercises_api import create

URL = "/api/v1/exercise-catalogue"


def test_catalogue_lists_everything_with_groups_and_motions(client):
    body = client.get(URL).json()
    assert len(body["items"]) == len(ENTRIES) >= 110
    assert body["muscle_groups"][:3] == ["Chest", "Back", "Shoulders"] and "Cardio" not in body["muscle_groups"]
    assert set(body["motions"]) == set(MOTIONS)
    assert all(not i["in_library"] for i in body["items"])
    item = next(i for i in body["items"] if i["name"] == "Incline Dumbbell Press")
    assert (item["muscle_group"], item["target_area"], item["equipment"], item["icon_motion"]) == (
        "Chest", "Upper Chest", "Dumbbell", "incline")


def test_every_catalogue_entry_can_be_added(client, session_factory):
    # proves each entry's group / area / equipment names match the seeded master data
    for e in ENTRIES:
        r = client.post(f"{URL}/{e.key}/add")
        assert r.status_code == 201, (e.name, r.text)
        got = r.json()
        assert got["name"] == e.name and got["muscle_group"]["name"] == e.muscle_group
        assert (got["target_area"] or {}).get("name") == e.target_area
        assert (got["workout_type"] or {}).get("name") == e.equipment
        assert got["exercise_master"]["icon_motion"] == e.icon_motion
    items = client.get(URL).json()["items"]
    assert all(i["in_library"] and i["exercise_id"] for i in items)


def test_adding_twice_is_blocked_without_a_duplicate(client):
    assert client.post(f"{URL}/barbell-curl/add").status_code == 201
    r = client.post(f"{URL}/barbell-curl/add")
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_in_library"
    assert len(client.get("/api/v1/exercises").json()["items"]) == 1


def test_existing_exercise_with_same_name_in_any_case_counts_as_in_library(client, ref):
    mine = create(client, ref, name="incline dumbbell press")
    item = next(i for i in client.get(URL).json()["items"] if i["key"] == "incline-dumbbell-press")
    assert item["in_library"] and item["exercise_id"] == mine["id"]
    assert client.post(f"{URL}/incline-dumbbell-press/add").status_code == 409


def test_unknown_key_is_404(client):
    assert client.post(f"{URL}/not-a-real-one/add").status_code == 404


def test_added_exercise_keeps_an_existing_masters_icon(client):
    client.post("/api/v1/exercise-masters", json={"name": "Hammer Curl", "icon_motion": "generic"})
    got = client.post(f"{URL}/hammer-curl/add").json()
    assert got["exercise_master"]["icon_motion"] == "generic"   # the user's own choice wins


def test_migration_a9e1_widens_motions_and_downgrade_maps_back(tmp_path):
    import os
    db = tmp_path / "c.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}"}
    run = lambda *a: subprocess.run([sys.executable, "-m", "alembic", *a], cwd=BACKEND, env=env, check=True, capture_output=True, text=True)
    run("upgrade", "f7c4d0e3a8b5")
    con = sqlite3.connect(db)
    try:
        con.execute("INSERT INTO exercise_masters(name,icon_motion,is_active,created_at,updated_at) VALUES ('X','fly',1,'2026-01-01','2026-01-01')")
        raise AssertionError("old schema should reject a newer motion")
    except sqlite3.IntegrityError:
        pass
    con.execute("INSERT INTO exercise_masters(name,icon_motion,is_active,created_at,updated_at) VALUES ('Old','curl',1,'2026-01-01','2026-01-01')")
    con.commit(); con.close()
    run("upgrade", "head")
    con = sqlite3.connect(db)
    con.execute("INSERT INTO exercise_masters(name,icon_motion,is_active,created_at,updated_at) VALUES ('New','incline',1,'2026-01-01','2026-01-01')")
    con.commit()
    assert "ux_exercise_masters_name_lower" in {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    con.close()
    assert "No new upgrade operations" in (run("check").stdout + run("check").stderr)
    run("downgrade", "f7c4d0e3a8b5")
    con = sqlite3.connect(db)
    got = dict(con.execute("SELECT name, icon_motion FROM exercise_masters").fetchall())
    assert got == {"Old": "curl", "New": DOWNGRADE_MAP["incline"]} and got["New"] in ORIGINAL_MOTIONS
    con.close()
    run("upgrade", "head")
