"""Settings API against throwaway databases (never the dev DB)."""
import sqlite3

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DataError, IntegrityError

from app.models import AppSettings

from dbhelpers import IS_PG, postgres_only, sqlite_only  # noqa: E402

URL = "/api/v1/settings"

DEFAULTS = {
    "display_name": None, "rest_between_sets_seconds": 90, "rest_between_exercises_seconds": 120,
    "target_workout_minutes": 60, "weight_unit": "kg", "distance_unit": "km",
    "week_start": "monday", "date_format": "DD MMM YYYY",
}


def payload(**over):
    return {**DEFAULTS, **over}


def fields(resp):
    body = resp.json()
    body.pop("updated_at", None)
    return body


class TestDefaults:
    def test_fresh_database_returns_defaults(self, client):
        r = client.get(URL)
        assert r.status_code == 200
        assert fields(r) == DEFAULTS
        assert r.json()["updated_at"].endswith("Z")

    def test_missing_row_is_recreated_with_defaults(self, client, session_factory):
        with session_factory() as db:
            db.query(AppSettings).delete()
            db.commit()
        assert fields(client.get(URL)) == DEFAULTS


class TestUpdate:
    def test_update_and_read_back(self, client):
        new = payload(display_name="Gokul", rest_between_sets_seconds=45, rest_between_exercises_seconds=0,
                      target_workout_minutes=75, weight_unit="lbs", distance_unit="miles",
                      week_start="sunday", date_format="YYYY-MM-DD")
        r = client.put(URL, json=new)
        assert r.status_code == 200 and fields(r) == new
        assert fields(client.get(URL)) == new

    def test_persists_across_a_new_connection(self, client, session_factory, db_url):
        from app.db.session import create_app_engine
        client.put(URL, json=payload(display_name="Persisted", weight_unit="lbs"))
        fresh = create_app_engine(db_url)      # an independent connection = what a backend restart would see
        try:
            with fresh.connect() as con:
                assert con.execute(text("SELECT display_name, weight_unit FROM app_settings")).fetchall() == [("Persisted", "lbs")]
        finally:
            fresh.dispose()

    def test_display_name_is_trimmed_and_blank_becomes_null(self, client):
        assert client.put(URL, json=payload(display_name="  Gokul   K  ")).json()["display_name"] == "Gokul K"
        assert client.put(URL, json=payload(display_name="   ")).json()["display_name"] is None
        assert client.put(URL, json=payload(display_name=None)).json()["display_name"] is None

    def test_boundaries_are_accepted(self, client):
        ok = payload(rest_between_sets_seconds=0, rest_between_exercises_seconds=3600, target_workout_minutes=600,
                     display_name="x" * 50)
        assert client.put(URL, json=ok).status_code == 200
        assert client.put(URL, json=payload(target_workout_minutes=1)).status_code == 200

    def test_update_does_not_touch_plans_or_exercises(self, client, session_factory, ref):
        client.post("/api/v1/exercises", json={"name": "Rope", "muscle_group_id": ref["muscle"]["Back"]})
        cycle = client.post("/api/v1/cycles", json={"name": "Winter", "start_date": "2026-11-23", "total_weeks": 4})
        assert cycle.status_code == 201
        before = (client.get("/api/v1/exercises").json(), client.get("/api/v1/cycles").json())
        client.put(URL, json=payload(weight_unit="lbs", week_start="sunday", target_workout_minutes=20))
        assert (client.get("/api/v1/exercises").json(), client.get("/api/v1/cycles").json()) == before


class TestValidation:
    @pytest.mark.parametrize("field,value", [
        ("rest_between_sets_seconds", -1),
        ("rest_between_sets_seconds", 3601),
        ("rest_between_sets_seconds", 90.5),
        ("rest_between_sets_seconds", "90"),
        ("rest_between_sets_seconds", True),
        ("rest_between_sets_seconds", None),
        ("rest_between_exercises_seconds", -5),
        ("rest_between_exercises_seconds", 99999),
        ("target_workout_minutes", 0),
        ("target_workout_minutes", -30),
        ("target_workout_minutes", 601),
        ("target_workout_minutes", None),
        ("weight_unit", "stone"),
        ("weight_unit", "KG"),
        ("distance_unit", "metres"),
        ("week_start", "tuesday"),
        ("date_format", "MM/DD/YYYY"),
        ("date_format", "dd/mm/yyyy"),
        ("display_name", "x" * 51),
    ])
    def test_rejects_invalid_value_with_field_error(self, client, field, value):
        r = client.put(URL, json=payload(**{field: value}))
        assert r.status_code == 422
        err = r.json()["error"]
        assert err["code"] == "validation_error"
        assert any(d["field"] == field for d in err["details"]), err
        assert fields(client.get(URL)) == DEFAULTS  # nothing was saved

    def test_missing_field_is_rejected(self, client):
        body = payload()
        del body["weight_unit"]
        assert client.put(URL, json=body).status_code == 422

    def test_unknown_field_is_rejected(self, client):
        r = client.put(URL, json=payload(password="hunter2"))
        assert r.status_code == 422

    def test_invalid_update_does_not_partly_apply(self, client):
        client.put(URL, json=payload(display_name="Before"))
        r = client.put(URL, json=payload(display_name="Changed", target_workout_minutes=0))
        assert r.status_code == 422
        assert client.get(URL).json()["display_name"] == "Before"

    def test_no_auth_fields_exist(self, client):
        keys = set(client.get(URL).json())
        assert not keys & {"email", "password", "username", "token"}


class TestSingleRecord:
    def test_many_updates_keep_one_row(self, client, session_factory):
        for i in range(5):
            client.put(URL, json=payload(target_workout_minutes=30 + i))
        client.post(f"{URL}/reset", json={"section": "all"})
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(AppSettings)) == 1
            assert db.scalar(select(AppSettings.id)) == 1

    def test_each_person_gets_their_own_settings_row(self, session_factory):
        from app.models.user import User
        with session_factory() as db:
            db.add(User(id=2, email="other@example.com")); db.flush()
            db.add(AppSettings(id=2, user_id=2, weight_unit="lbs"))
            db.commit()
            assert db.scalar(select(func.count()).select_from(AppSettings).execution_options(unscoped=True)) == 2
            assert db.scalar(select(AppSettings.weight_unit)) == "kg"          # this session sees only its own user's row

    def test_database_refuses_a_value_that_breaks_a_CHECK_rule_even_if_the_api_is_bypassed(self, session_factory):
        """"xyz" fits the column on both databases, so the only thing refusing it is the CHECK constraint."""
        with session_factory() as db:
            row = db.get(AppSettings, 1)
            row.weight_unit = "xyz"
            with pytest.raises(IntegrityError):
                db.commit()

    def test_database_refuses_a_value_that_is_far_too_wrong_even_if_the_api_is_bypassed(self, session_factory):
        """"stone" breaks the CHECK rule. PostgreSQL also notices it is longer than the 3-character column and says so first
        (a DataError); SQLite checks the rule (an IntegrityError). Either way the bad value is never stored."""
        with session_factory() as db:
            row = db.get(AppSettings, 1)
            row.weight_unit = "stone"
            with pytest.raises((IntegrityError, DataError)):
                db.commit()
            db.rollback()
            assert db.get(AppSettings, 1).weight_unit == "kg"


class TestReset:
    CHANGED = dict(display_name="Gokul", rest_between_sets_seconds=30, rest_between_exercises_seconds=45,
                   target_workout_minutes=90, weight_unit="lbs", distance_unit="miles",
                   week_start="sunday", date_format="YYYY-MM-DD")

    def test_reset_workout_section_only(self, client):
        client.put(URL, json=payload(**self.CHANGED))
        r = client.post(f"{URL}/reset", json={"section": "workout"})
        assert r.status_code == 200
        got = fields(r)
        for key in ("rest_between_sets_seconds", "rest_between_exercises_seconds", "target_workout_minutes",
                    "weight_unit", "distance_unit"):
            assert got[key] == DEFAULTS[key]
        assert (got["display_name"], got["week_start"], got["date_format"]) == ("Gokul", "sunday", "YYYY-MM-DD")

    def test_reset_calendar_section_only(self, client):
        client.put(URL, json=payload(**self.CHANGED))
        got = fields(client.post(f"{URL}/reset", json={"section": "calendar"}))
        assert (got["week_start"], got["date_format"]) == ("monday", "DD MMM YYYY")
        assert got["weight_unit"] == "lbs" and got["display_name"] == "Gokul"

    def test_reset_personal_section_only(self, client):
        client.put(URL, json=payload(**self.CHANGED))
        got = fields(client.post(f"{URL}/reset", json={"section": "personal"}))
        assert got["display_name"] is None and got["weight_unit"] == "lbs" and got["week_start"] == "sunday"

    def test_reset_all(self, client):
        client.put(URL, json=payload(**self.CHANGED))
        assert fields(client.post(f"{URL}/reset", json={"section": "all"})) == DEFAULTS
        assert fields(client.get(URL)) == DEFAULTS

    def test_unknown_section_rejected(self, client):
        client.put(URL, json=payload(**self.CHANGED))
        assert client.post(f"{URL}/reset", json={"section": "everything"}).status_code == 422
        assert client.post(f"{URL}/reset", json={}).status_code == 422
        assert client.get(URL).json()["weight_unit"] == "lbs"

    def test_reset_leaves_plans_and_exercises_alone(self, client, ref):
        client.post("/api/v1/exercises", json={"name": "Rope", "muscle_group_id": ref["muscle"]["Back"]})
        before = client.get("/api/v1/exercises").json()
        client.post(f"{URL}/reset", json={"section": "all"})
        assert client.get("/api/v1/exercises").json() == before


class TestDataManagement:
    def test_info_has_counts_and_no_paths_or_secrets(self, client, ref, db_url):
        client.post("/api/v1/exercises", json={"name": "Rope", "muscle_group_id": ref["muscle"]["Back"]})
        r = client.get(f"{URL}/data")
        assert r.status_code == 200
        body = r.json()
        assert body["database_engine"] == ("PostgreSQL" if IS_PG else "SQLite")
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        head = ScriptDirectory.from_config(Config(str(__import__("pathlib").Path(__file__).resolve().parents[1] / "alembic.ini"))).get_current_head()
        assert body["schema_version"] == head
        assert body["counts"]["exercises"] == 1 and body["counts"]["cycles"] == 0
        assert body["database_size_bytes"] > 0
        assert body["backup_includes"]
        text = r.text.lower()
        assert db_url.lower() not in text and "gym_planner.db" not in text and "127.0.0.1" not in text
        assert "sqlite:///" not in text and "postgresql" not in text.replace(body["database_engine"].lower(), "") and "password" not in text

    @postgres_only
    def test_on_a_managed_database_backups_are_left_to_rds(self, client, ref):
        """Intentional: with PostgreSQL (AWS RDS) the app offers no file download. RDS makes the backups and snapshots."""
        client.post("/api/v1/exercises", json={"name": "Rope", "muscle_group_id": ref["muscle"]["Back"]})
        r = client.get(f"{URL}/data/backup")
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "backup_unsupported"
        assert "RDS" in r.json()["error"]["message"]
        assert "content-disposition" not in r.headers and not r.content.startswith(b"SQLite format 3")      # no file of any kind
        assert client.get("/api/v1/exercises").json()["items"][0]["name"] == "Rope"                       # and nothing was touched

    @postgres_only
    def test_info_reports_postgresql_with_a_real_size_and_the_latest_schema(self, client):
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        body = client.get(f"{URL}/data").json()
        head = ScriptDirectory.from_config(Config(str(__import__("pathlib").Path(__file__).resolve().parents[1] / "alembic.ini"))).get_current_head()
        assert body["database_engine"] == "PostgreSQL" and body["schema_version"] == head and body["database_size_bytes"] > 0

    @sqlite_only
    def test_backup_is_a_valid_complete_database(self, client, ref, tmp_path):
        client.post("/api/v1/exercises", json={"name": "Rope", "muscle_group_id": ref["muscle"]["Back"]})
        client.post("/api/v1/cycles", json={"name": "Winter", "start_date": "2026-11-23", "total_weeks": 4})
        client.put(URL, json=payload(display_name="Backed up"))
        r = client.get(f"{URL}/data/backup")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/vnd.sqlite3")
        assert r.headers["cache-control"] == "no-store"
        disposition = r.headers["content-disposition"]
        assert 'filename="gym-planner-backup-' in disposition and disposition.rstrip('"').endswith(".db")
        assert "/" not in disposition and "\\" not in disposition  # no filesystem path leaks
        assert r.content.startswith(b"SQLite format 3")

        copy = tmp_path / "restored.db"
        copy.write_bytes(r.content)
        con = sqlite3.connect(copy)
        assert con.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert con.execute("PRAGMA foreign_key_check").fetchall() == []
        assert con.execute("SELECT name FROM exercises").fetchall() == [("Rope",)]
        assert con.execute("SELECT name, status FROM workout_cycles").fetchall() == [("Winter", "draft")]
        assert con.execute("SELECT display_name FROM app_settings").fetchone() == ("Backed up",)
        assert con.execute("SELECT COUNT(*) FROM muscle_groups").fetchone()[0] == 11
        assert con.execute("PRAGMA journal_mode").fetchone() == ("delete",)
        con.close()

    @sqlite_only
    def test_backup_includes_changes_still_in_the_wal(self, client, db_path, ref):
        """The reason the backup API is used: a plain file copy would miss uncommitted-to-main-file pages."""
        client.post("/api/v1/exercises", json={"name": "Only In Wal", "muscle_group_id": ref["muscle"]["Back"]})
        body = client.get(f"{URL}/data/backup").content
        copy = db_path.parent / "snap.db"
        copy.write_bytes(body)
        con = sqlite3.connect(copy)
        assert ("Only In Wal",) in con.execute("SELECT name FROM exercises").fetchall()
        con.close()

    def test_backup_does_not_modify_the_source(self, client, ref):
        client.post("/api/v1/exercises", json={"name": "Rope", "muscle_group_id": ref["muscle"]["Back"]})
        before = client.get("/api/v1/exercises").json()
        client.get(f"{URL}/data/backup")
        client.get(f"{URL}/data/backup")
        assert client.get("/api/v1/exercises").json() == before

    def test_backup_temp_file_is_removed_after_sending(self, client):
        import glob, tempfile, os
        pattern = os.path.join(tempfile.gettempdir(), "gym-planner-backup-*.db")
        before = set(glob.glob(pattern))
        client.get(f"{URL}/data/backup")
        assert set(glob.glob(pattern)) <= before
