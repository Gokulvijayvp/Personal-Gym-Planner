"""Many users, one database: the first account is the admin, everyone else is a normal user, and nobody can see,
change or delete another person's data - even by guessing ids (IDOR)."""
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.scope import owned_models
from app.main import app
from app.models import Exercise, ExerciseSet
from app.services import email_service
from dbhelpers import IS_PG

API = "/api/v1"
PW = "a-strong-test-password"


@pytest.fixture(autouse=True)
def _pinned_admin(monkeypatch):
    monkeypatch.setattr(settings, "admin_email", "alice@example.com")


@pytest.fixture
def sent(monkeypatch):
    codes: list[str] = []
    monkeypatch.setattr(email_service, "send_otp", lambda email, code, purpose: codes.append(code))
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)
    return codes


def sign_up(sent, email, name=None) -> TestClient:
    """A separate browser: its own cookie jar, signed up through the real email-code flow."""
    c = TestClient(app, raise_server_exceptions=False)
    assert c.post(f"{API}/auth/signup/request-otp", json={"email": email, "password": PW, "full_name": name}).status_code == 200
    r = c.post(f"{API}/auth/verify-otp", json={"email": email, "code": sent[-1]})
    assert r.status_code == 200, r.text
    return c


def w(c, method, url, **kw):
    """A write the way the frontend sends it: with the CSRF header."""
    return c.request(method, API + url, headers={"X-CSRF-Token": c.cookies.get("gp_csrf")}, **kw)


@pytest.fixture
def users(anon_client, sent):
    """alice = first sign-up (admin), bob and carol = normal users, all against the same database."""
    return sign_up(sent, "alice@example.com", "Alice"), sign_up(sent, "bob@example.com", "Bob"), sign_up(sent, "carol@example.com")


def mk_exercise(c, name="Bench Press"):
    ref = {g["name"]: g["id"] for g in c.get(f"{API}/muscle-groups").json()}
    r = w(c, "POST", "/exercises", json={"name": name, "muscle_group_id": ref["Chest"]})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ----------------------------------------------------------------------------- roles

def test_first_signup_is_admin_and_everyone_after_is_a_normal_user(users):
    assert [c.get(f"{API}/auth/me").json()["role"] for c in users] == ["admin", "user", "user"]


def test_signup_stays_open_but_an_existing_email_cannot_be_registered_again(users):
    r = TestClient(app).post(f"{API}/auth/signup/request-otp", json={"email": "BOB@example.com", "password": PW})
    assert r.status_code == 409


def test_the_first_account_claims_data_that_existed_before_accounts_and_nobody_else_does(anon_client, sent, session_factory):
    plain = sessionmaker(bind=session_factory.kw["bind"])                   # no user scope: how old, ownerless rows look
    with plain() as db:
        mg = db.execute(text("select id from muscle_groups limit 1")).scalar()
        db.add(Exercise(name="Old Bench", muscle_group_id=mg))              # stored with no owner, like data from before accounts
        db.commit()
    alice = sign_up(sent, "alice@example.com")
    bob = sign_up(sent, "bob@example.com")
    assert [e["name"] for e in alice.get(f"{API}/exercises").json()["items"]] == ["Old Bench"]       # kept, now Alice's
    assert bob.get(f"{API}/exercises").json()["items"] == []
    with plain() as db:
        assert db.execute(text("select count(*) from exercises where user_id is null")).scalar() == 0


# ----------------------------------------------------------------------------- isolation (IDOR)

def test_exercises_are_private(users):
    alice, bob, _ = users
    ex = mk_exercise(alice)
    assert [e["id"] for e in alice.get(f"{API}/exercises").json()["items"]] == [ex]
    assert bob.get(f"{API}/exercises").json()["items"] == []
    assert bob.get(f"{API}/exercises/{ex}").status_code == 404
    assert w(bob, "PUT", f"/exercises/{ex}", json={"name": "Hacked"}).status_code in (404, 422)
    assert w(bob, "PATCH", f"/exercises/{ex}/status", json={"is_active": False}).status_code == 404
    assert w(bob, "DELETE", f"/exercises/{ex}").status_code == 404
    assert alice.get(f"{API}/exercises/{ex}").json()["name"] == "Bench Press"           # untouched


def test_the_same_exercise_name_is_allowed_for_different_people_but_not_twice_for_one(users):
    alice, bob, _ = users
    mk_exercise(alice), mk_exercise(bob)
    ref = {g["name"]: g["id"] for g in alice.get(f"{API}/muscle-groups").json()}
    assert w(alice, "POST", "/exercises", json={"name": "bench press", "muscle_group_id": ref["Chest"]}).status_code == 409


def test_cycles_plans_and_days_are_private(users):
    alice, bob, _ = users
    cid = w(alice, "POST", "/cycles", json={"name": "Winter", "start_date": "2026-11-16", "total_weeks": 4}).json()["id"]
    bobs = bob.get(f"{API}/cycles").json()
    assert (bobs["items"] if isinstance(bobs, dict) else bobs) == []
    for method, url in (("GET", f"/cycles/{cid}"), ("PUT", f"/cycles/{cid}"), ("DELETE", f"/cycles/{cid}"), ("POST", f"/cycles/{cid}/activate"),
                        ("POST", f"/cycles/{cid}/archive"), ("GET", f"/cycles/{cid}/weeks/1"), ("GET", f"/cycles/{cid}/weeks/1/days/1"),
                        ("DELETE", f"/cycles/{cid}/weeks/1/days/1"), ("POST", f"/cycles/{cid}/weeks/1/copy")):
        r = bob.get(API + url) if method == "GET" else w(bob, method, url, json={})
        assert r.status_code in (404, 422), (method, url, r.status_code)
    assert alice.get(f"{API}/cycles/{cid}").status_code == 200


def test_workout_history_and_everything_inside_a_workout_is_private(users):
    alice, bob, _ = users
    sid = w(alice, "POST", "/workouts", json={"source": "blank"}).json()["id"]
    assert alice.get(f"{API}/workouts/current").status_code == 200
    assert bob.get(f"{API}/workouts/{sid}").status_code == 404
    for method, url in (("POST", f"/workouts/{sid}/complete"), ("POST", f"/workouts/{sid}/cancel"), ("POST", f"/workouts/{sid}/exercises"),
                        ("PATCH", f"/workouts/{sid}/exercises/1"), ("DELETE", f"/workouts/{sid}/exercises/1"),
                        ("PATCH", f"/workouts/{sid}/sets/1"), ("DELETE", f"/workouts/{sid}/sets/1"), ("POST", f"/workouts/{sid}/cardio")):
        assert w(bob, method, url, json={}).status_code in (404, 422), (method, url)
    assert alice.get(f"{API}/workouts/{sid}").json()["status"] == "in_progress"            # still Alice's, still running
    listing = bob.get(f"{API}/workouts").json()
    assert (listing["items"] if isinstance(listing, dict) else listing) == []


def test_two_people_can_each_have_a_workout_running_today(users):
    alice, bob, _ = users
    assert w(alice, "POST", "/workouts", json={"source": "blank"}).status_code == 201
    assert w(bob, "POST", "/workouts", json={"source": "blank"}).status_code == 201          # "one active per day" is per person now


def test_exercise_sets_are_private(users):
    alice, bob, _ = users
    sid = w(alice, "POST", "/exercise-sets", json={"name": "Chest A", "muscle_group": "Chest", "exercise_keys": []})
    assert sid.status_code in (201, 422), sid.text
    if sid.status_code == 201:
        i = sid.json()["id"]
        assert bob.get(f"{API}/exercise-sets").json() == []
        assert w(bob, "PUT", f"/exercise-sets/{i}", json={"name": "x", "muscle_group": "Chest", "exercise_keys": []}).status_code == 404
        assert w(bob, "DELETE", f"/exercise-sets/{i}").status_code == 404
        assert len(alice.get(f"{API}/exercise-sets").json()) == 1


def test_settings_are_per_person(users):
    alice, bob, carol = users
    base = alice.get(f"{API}/settings").json()
    changed = {**{k: v for k, v in base.items() if k not in ("id", "updated_at", "created_at")}, "display_name": "Alice", "weight_unit": "lbs"}
    assert w(alice, "PUT", "/settings", json=changed).status_code == 200
    assert bob.get(f"{API}/settings").json()["weight_unit"] == "kg"                  # Bob still has the defaults
    assert bob.get(f"{API}/settings").json()["display_name"] in (None, "")
    assert alice.get(f"{API}/settings").json()["weight_unit"] == "lbs"
    assert carol.get(f"{API}/settings").status_code == 200


def test_dashboard_calendar_and_progress_only_count_your_own_data(users):
    alice, bob, _ = users
    mk_exercise(alice)
    w(alice, "POST", "/workouts", json={"source": "blank"})
    assert alice.get(f"{API}/dashboard").json()["stats"]["exercises_total"] == 1
    assert bob.get(f"{API}/dashboard").json()["stats"]["exercises_total"] == 0
    assert bob.get(f"{API}/settings/data").json()["counts"] == {"exercises": 0, "cycles": 0, "planned_days": 0, "workout_sessions": 0}
    assert alice.get(f"{API}/settings/data").json()["counts"]["exercises"] == 1
    ov = bob.get(f"{API}/progress/overview")
    assert ov.status_code == 200 and "Bench" not in ov.text


def test_catalogue_pictures_are_shared_but_only_the_admin_can_add_or_remove_them(users):
    alice, bob, _ = users
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    up = lambda c: c.post(f"{API}/exercise-catalogue/barbell-bench-press/media", files=[("files", ("a.png", io.BytesIO(png), "image/png"))],
                          headers={"X-CSRF-Token": c.cookies.get("gp_csrf")})
    assert up(bob).status_code == 403                                                   # a normal user cannot upload
    r = up(alice)
    assert r.status_code == 201, r.text
    mid = r.json()[0]["id"]
    for c in (alice, bob):                                                              # ...but everyone sees the admin's picture
        item = next(i for i in c.get(f"{API}/exercise-catalogue").json()["items"] if i["key"] == "barbell-bench-press")
        assert [m["id"] for m in item["media"]] == [mid]
        assert c.get(f"{API}/exercise-catalogue/media/{mid}/file").status_code == 200
    assert w(bob, "DELETE", f"/exercise-catalogue/media/{mid}").status_code == 403
    assert w(alice, "DELETE", f"/exercise-catalogue/media/{mid}").status_code == 204


def test_you_cannot_use_someone_elses_exercise_in_your_own_plan_or_workout(users):
    alice, bob, _ = users
    alices = mk_exercise(alice)
    cid = w(bob, "POST", "/cycles", json={"name": "Bob block", "start_date": "2026-11-16", "total_weeks": 2}).json()["id"]
    day = f"/cycles/{cid}/weeks/1/days/1"
    chest = next(g["id"] for g in bob.get(f"{API}/muscle-groups").json() if g["name"] == "Chest")
    w(bob, "POST", day + "/muscle-groups", json={"muscle_group_id": chest})
    r = w(bob, "POST", day + f"/muscle-groups/{chest}/exercises", json={"exercise_id": alices})
    assert r.status_code in (404, 422), r.text
    sid = w(bob, "POST", "/workouts", json={"source": "blank"}).json()["id"]
    r = w(bob, "POST", f"/workouts/{sid}/exercises", json={"exercise_id": alices})
    assert r.status_code in (404, 422), r.text


def test_a_user_id_sent_by_the_browser_is_refused_or_ignored(users):
    alice, bob, _ = users
    ref = {g["name"]: g["id"] for g in bob.get(f"{API}/muscle-groups").json()}
    r = w(bob, "POST", "/exercises", json={"name": "Sneaky", "muscle_group_id": ref["Chest"], "user_id": 1})
    assert r.status_code in (201, 422)                                               # unknown fields are rejected outright by the API
    assert alice.get(f"{API}/exercises").json()["items"] == []                      # in no case does it land in Alice's library
    if r.status_code == 201:
        assert [e["name"] for e in bob.get(f"{API}/exercises").json()["items"]] == ["Sneaky"]


# ----------------------------------------------------------------------------- admin-only actions

def test_only_the_admin_can_download_the_whole_database_or_edit_the_shared_exercise_list(users):
    alice, bob, _ = users
    mine = alice.get(f"{API}/settings/data/backup")
    if IS_PG:     # intentional: on a managed PostgreSQL database (RDS) the app gives no file; RDS makes the backups
        assert mine.status_code == 400 and mine.json()["error"]["code"] == "backup_unsupported" and "RDS" in mine.json()["error"]["message"]
    else:
        assert mine.status_code == 200 and mine.content.startswith(b"SQLite format 3")
    r = bob.get(f"{API}/settings/data/backup")          # a normal user is refused first, on both engines, and learns nothing
    assert r.status_code == 403 and b"SQLite" not in r.content and b"RDS" not in r.content
    for method, url in (("POST", "/exercise-masters"), ("PUT", "/exercise-masters/1"), ("DELETE", "/exercise-masters/1")):
        assert w(bob, method, url, json={"name": "x"}).status_code == 403
    assert w(alice, "POST", "/exercise-masters", json={"name": "Admin Only Exercise", "icon_motion": "press"}).status_code in (201, 422)
    assert bob.get(f"{API}/exercise-masters").status_code == 200                      # reading the shared list is fine


# ----------------------------------------------------------------------------- the filter itself

def test_every_private_table_is_covered_by_the_filter():
    names = {m.__tablename__ for m in owned_models()}
    assert names == {"workout_cycles", "weekly_plans", "daily_schedules", "schedule_muscle_groups", "schedule_exercises", "schedule_cardio",
                     "exercises", "body_metrics", "workout_sessions", "workout_session_exercises", "workout_session_sets",
                     "workout_session_cardio", "exercise_sets", "exercise_set_items", "app_settings"}


def test_rows_always_get_an_owner_and_nobody_can_see_unowned_rows(users, session_factory):
    alice, bob, _ = users
    mk_exercise(alice), mk_exercise(bob), w(bob, "POST", "/workouts", json={"source": "blank"})
    plain = sessionmaker(bind=session_factory.kw["bind"])
    with plain() as db:
        for m in owned_models():
            n = db.execute(text(f"select count(*) from {m.__tablename__} where user_id is null")).scalar()
            assert n == 0, f"{m.__tablename__} has {n} rows with no owner"


def test_a_session_scoped_to_one_user_cannot_read_or_delete_anothers_rows_even_with_raw_orm_queries(users, session_factory):
    alice, bob, _ = users
    ex = mk_exercise(alice)
    plain = sessionmaker(bind=session_factory.kw["bind"])
    with plain() as db:
        alice_id = db.execute(text("select id from users where email='alice@example.com'")).scalar()
        bob_id = db.execute(text("select id from users where email='bob@example.com'")).scalar()
    with plain(info={"user_id": bob_id}) as db:
        assert db.scalars(select(Exercise)).all() == []
        assert db.get(Exercise, ex) is None
        assert db.query(Exercise).filter(Exercise.id == ex).delete() == 0                # a bulk delete matches nothing
        assert db.scalar(select(func.count()).select_from(Exercise)) == 0
        db.add(ExerciseSet(name="mine", muscle_group="Chest")); db.commit()
        assert db.scalars(select(ExerciseSet.user_id)).all() == [bob_id]                 # new rows are stamped automatically
    with plain(info={"user_id": alice_id}) as db:
        assert [e.id for e in db.scalars(select(Exercise))] == [ex]
        assert db.scalars(select(ExerciseSet)).all() == []


# ----------------------------------------------------------------------------- "My exercises" and Workout belong to one person each

def test_my_exercises_sets_are_separate_per_person_even_with_the_same_name_and_exercises(users):
    alice, bob, carol = users
    body = {"name": "Chest A", "muscle_group": "Chest", "exercise_keys": ["barbell-bench-press", "dumbbell-fly"]}
    a = w(alice, "POST", "/exercise-sets", json=body)
    b = w(bob, "POST", "/exercise-sets", json={**body, "exercise_keys": ["push-ups"]})          # same set name, different exercises
    assert a.status_code == b.status_code == 201, (a.text, b.text)
    assert w(alice, "POST", "/exercise-sets", json=body).status_code == 409                     # a name is unique per person...
    assert [s["name"] for s in alice.get(f"{API}/exercise-sets").json()] == ["Chest A"]
    assert [e["key"] for e in alice.get(f"{API}/exercise-sets").json()[0]["exercises"]] == ["barbell-bench-press", "dumbbell-fly"]
    assert [e["key"] for e in bob.get(f"{API}/exercise-sets").json()[0]["exercises"]] == ["push-ups"]    # ...and each sees only their own
    assert carol.get(f"{API}/exercise-sets").json() == []
    assert alice.get(f"{API}/dashboard").json()["stats"]["exercise_sets"] == 1
    assert carol.get(f"{API}/dashboard").json()["stats"]["exercise_sets"] == 0
    assert w(bob, "DELETE", f"/exercise-sets/{a.json()['id']}").status_code == 404              # Bob cannot delete Alice's
    assert len(alice.get(f"{API}/exercise-sets").json()) == 1


def test_workout_plans_days_and_logged_sessions_are_separate_per_person(users):
    alice, bob, carol = users

    def build(c, name):
        ex = mk_exercise(c, f"{name} Press")
        cid = w(c, "POST", "/cycles", json={"name": f"{name} block", "start_date": "2026-11-16", "total_weeks": 4}).json()["id"]
        chest = next(g["id"] for g in c.get(f"{API}/muscle-groups").json() if g["name"] == "Chest")
        day = f"/cycles/{cid}/weeks/1/days/1"
        w(c, "POST", day + "/muscle-groups", json={"muscle_group_id": chest})
        assert w(c, "POST", day + f"/muscle-groups/{chest}/exercises", json={"exercise_id": ex}).status_code == 201
        sid = w(c, "POST", "/workouts", json={"source": "blank"}).json()["id"]
        return cid, ex, sid

    a_cycle, a_ex, a_session = build(alice, "Alice")
    b_cycle, b_ex, b_session = build(bob, "Bob")
    for c, cycle, ex, sid, mine in ((alice, a_cycle, a_ex, a_session, "Alice"), (bob, b_cycle, b_ex, b_session, "Bob")):
        cycles = c.get(f"{API}/cycles").json()
        assert [x["name"] for x in (cycles["items"] if isinstance(cycles, dict) else cycles)] == [f"{mine} block"]
        assert [e["name"] for e in c.get(f"{API}/exercises").json()["items"]] == [f"{mine} Press"]
        day = c.get(f"{API}/cycles/{cycle}/weeks/1/days/1").json()
        assert mine in str(day) and ("Bob" if mine == "Alice" else "Alice") not in str(day)
        assert c.get(f"{API}/workouts/{sid}").status_code == 200
    # nobody reaches into the other person's plan or workout, and a third person has nothing at all
    assert alice.get(f"{API}/cycles/{b_cycle}").status_code == 404 and bob.get(f"{API}/workouts/{a_session}").status_code == 404
    assert carol.get(f"{API}/exercises").json()["items"] == []
    carols = carol.get(f"{API}/cycles").json()
    assert (carols["items"] if isinstance(carols, dict) else carols) == []
    assert carol.get(f"{API}/dashboard").json()["stats"]["exercises_total"] == 0
