"""Share one day or one whole week of a workout plan with a code; another user pastes it into their own plan."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.core.timezone import utc_now_naive
from app.main import app
from app.models.plan_share import PlanShare
from app.services import email_service

API = "/api/v1"
PW = "a-strong-test-password"


@pytest.fixture
def people(anon_client, monkeypatch):
    codes = []
    monkeypatch.setattr(email_service, "send_otp", lambda email, code, purpose: codes.append(code))
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)

    def sign_up(email):
        c = TestClient(app, raise_server_exceptions=False)
        c.post(f"{API}/auth/signup/request-otp", json={"email": email, "password": PW})
        assert c.post(f"{API}/auth/verify-otp", json={"email": email, "code": codes[-1]}).status_code == 200
        return c
    return sign_up("alice@example.com"), sign_up("bob@example.com"), sign_up("carol@example.com")


def w(c, method, url, **kw):
    return c.request(method, API + url, headers={"X-CSRF-Token": c.cookies.get("gp_csrf")}, **kw)


def ids(c):
    groups = {g["name"]: g["id"] for g in c.get(f"{API}/muscle-groups").json()}
    cardio = {a["name"]: a["id"] for a in c.get(f"{API}/cardio-activities").json()}
    return groups, cardio


def make_exercise(c, name, group, **kw):
    groups, _ = ids(c)
    r = w(c, "POST", "/exercises", json={"name": name, "muscle_group_id": groups[group], **kw})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def make_cycle(c, name="Block"):
    r = w(c, "POST", "/cycles", json={"name": name, "start_date": "2026-11-16", "total_weeks": 4})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def plan_day(c, cycle, week, dow, items, cardio=None):
    """items: [(group, exercise_id, sets, reps)]"""
    groups, acts = ids(c)
    base = f"/cycles/{cycle}/weeks/{week}/days/{dow}"
    for group in dict.fromkeys(g for g, *_ in items):
        assert w(c, "POST", base + "/muscle-groups", json={"muscle_group_id": groups[group]}).status_code in (200, 201)
    for group, ex, sets, reps in items:
        r = w(c, "POST", base + f"/muscle-groups/{groups[group]}/exercises", json={"exercise_id": ex, "target_sets": sets, "target_reps": reps, "notes": "slow"})
        assert r.status_code == 201, r.text
    if cardio:
        assert w(c, "POST", base + "/cardio", json={"cardio_activity_id": acts[cardio[0]], "duration_minutes": cardio[1]}).status_code in (200, 201)


def day(c, cycle, week, dow):
    return c.get(f"{API}/cycles/{cycle}/weeks/{week}/days/{dow}").json()


def summary(d):
    """(muscle group, exercise name, sets, reps, notes) for each planned exercise, plus cardio."""
    out = [(g["muscle_group"]["name"], e["exercise"]["name"], e["target_sets"], e["target_reps"], e["notes"]) for g in d["strength"] for e in g["exercises"]]
    return out, [(c["cardio_activity"]["name"], c["duration_minutes"]) for c in d["cardio"]]


@pytest.fixture
def alice_plan(people):
    alice, bob, carol = people
    bench = make_exercise(alice, "Alice Bench", "Chest")
    fly = make_exercise(alice, "Alice Fly", "Chest")
    pushdown = make_exercise(alice, "Alice Pushdown", "Triceps")
    cycle = make_cycle(alice, "Alice block")
    plan_day(alice, cycle, 1, 0, [("Chest", bench, 4, "8-10"), ("Chest", fly, 3, "12"), ("Triceps", pushdown, 3, "15")], cardio=("Running", 20))
    plan_day(alice, cycle, 1, 2, [("Chest", bench, 5, "5")])
    return people, cycle


# ----------------------------------------------------------------------------- sharing

def test_share_a_day_and_a_week_make_readable_codes(alice_plan):
    (alice, _, _), cycle = alice_plan
    d = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0})
    wk = w(alice, "POST", "/plan-shares/week", json={"cycle_id": cycle, "week_number": 1})
    assert d.status_code == wk.status_code == 201, (d.text, wk.text)
    assert (d.json()["kind"], d.json()["days_count"]) == ("day", 1)
    assert (wk.json()["kind"], wk.json()["days_count"]) == ("week", 2)               # two planned days in week 1
    for code in (d.json()["code"], wk.json()["code"]):
        assert len(code) == 11 and code[5] == "-"
    assert d.json()["code"] != wk.json()["code"]


def test_nothing_planned_means_nothing_to_share(alice_plan):
    (alice, _, _), cycle = alice_plan
    for url, body in (("/plan-shares/day", {"cycle_id": cycle, "week_number": 1, "day_of_week": 4}),     # Friday is empty
                      ("/plan-shares/week", {"cycle_id": cycle, "week_number": 3})):                    # week 3 is empty
        r = w(alice, "POST", url, json=body)
        assert r.status_code == 400 and r.json()["error"]["code"] == "nothing_to_share"


def test_you_cannot_share_someone_elses_plan(alice_plan):
    (alice, bob, _), cycle = alice_plan
    assert w(bob, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0}).status_code == 404
    assert w(bob, "POST", "/plan-shares/week", json={"cycle_id": cycle, "week_number": 1}).status_code == 404


# ----------------------------------------------------------------------------- preview

def test_preview_describes_a_week_and_lists_exercises_the_importer_lacks(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/week", json={"cycle_id": cycle, "week_number": 1}).json()["code"]
    make_exercise(bob, "alice bench", "Chest")                                         # Bob already has one of them (any letter case)
    r = w(bob, "POST", "/plan-shares/preview", json={"code": code})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["kind"] == "week" and [d["name"] for d in p["days"]] == ["Monday", "Wednesday"]
    monday = p["days"][0]
    assert (monday["muscle_groups"], monday["exercise_count"], monday["cardio_count"]) == (["Chest", "Triceps"], 3, 1)
    assert p["new_exercises"] == ["Alice Fly", "Alice Pushdown"]                       # will be added to Bob's library


def test_preview_changes_nothing(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0}).json()["code"]
    w(bob, "POST", "/plan-shares/preview", json={"code": code})
    assert bob.get(f"{API}/exercises").json()["items"] == []


# ----------------------------------------------------------------------------- importing a day

def test_a_day_code_copies_that_day_onto_the_chosen_weekday_of_your_plan(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0}).json()["code"]
    bobs = make_cycle(bob, "Bob block")
    r = w(bob, "POST", "/plan-shares/import", json={"code": code, "cycle_id": bobs, "week_number": 2, "day_of_week": 4})
    assert r.status_code == 200, r.text
    assert (r.json()["kind"], r.json()["replaced_days"], r.json()["imported_days"]) == ("day", 0, 1)
    assert sorted(r.json()["added_exercises"]) == ["Alice Bench", "Alice Fly", "Alice Pushdown"]
    copy = day(bob, bobs, 2, 4)                                                         # Friday of week 2
    assert summary(copy) == summary(day(alice, cycle, 1, 0))                             # same groups, exercises, sets, reps, notes, cardio
    assert sorted(e["name"] for e in bob.get(f"{API}/exercises").json()["items"]) == ["Alice Bench", "Alice Fly", "Alice Pushdown"]


def test_a_day_code_needs_a_target_weekday(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0}).json()["code"]
    r = w(bob, "POST", "/plan-shares/import", json={"code": code, "cycle_id": make_cycle(bob), "week_number": 1})
    assert r.status_code == 422 and r.json()["error"]["code"] == "day_required"


def test_importing_onto_a_planned_day_needs_confirmation_then_replaces_it(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 2}).json()["code"]   # Alice's Wednesday
    bench = make_exercise(bob, "Bob Squat", "Quadriceps")
    bobs = make_cycle(bob)
    plan_day(bob, bobs, 1, 1, [("Quadriceps", bench, 3, "10")])                                                               # Bob's Tuesday
    body = {"code": code, "cycle_id": bobs, "week_number": 1, "day_of_week": 1}
    no = w(bob, "POST", "/plan-shares/import", json=body)
    assert no.status_code == 409 and no.json()["error"]["code"] == "target_not_empty"
    assert summary(day(bob, bobs, 1, 1))[0] == [("Quadriceps", "Bob Squat", 3, "10", "slow")]                                  # still there
    yes = w(bob, "POST", "/plan-shares/import", json={**body, "confirm_replace": True})
    assert yes.status_code == 200 and yes.json()["replaced_days"] == 1
    assert summary(day(bob, bobs, 1, 1))[0] == [("Chest", "Alice Bench", 5, "5", "slow")]                                      # replaced


def test_other_days_of_your_week_are_untouched_by_a_day_import(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 2}).json()["code"]
    squat = make_exercise(bob, "Bob Squat", "Quadriceps")
    bobs = make_cycle(bob)
    plan_day(bob, bobs, 1, 0, [("Quadriceps", squat, 3, "10")])
    w(bob, "POST", "/plan-shares/import", json={"code": code, "cycle_id": bobs, "week_number": 1, "day_of_week": 3})
    assert summary(day(bob, bobs, 1, 0))[0] == [("Quadriceps", "Bob Squat", 3, "10", "slow")]


# ----------------------------------------------------------------------------- importing a week

def test_a_week_code_copies_every_day_of_the_week(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/week", json={"cycle_id": cycle, "week_number": 1}).json()["code"]
    bobs = make_cycle(bob)
    r = w(bob, "POST", "/plan-shares/import", json={"code": code, "cycle_id": bobs, "week_number": 3})
    assert r.status_code == 200, r.text
    assert (r.json()["kind"], r.json()["imported_days"]) == ("week", 2)
    for dow in (0, 2):
        assert summary(day(bob, bobs, 3, dow)) == summary(day(alice, cycle, 1, dow))
    assert day(bob, bobs, 3, 1)["status"] == "unplanned"                                # days that were empty stay empty


def test_a_week_import_replaces_the_whole_target_week_after_confirmation(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/week", json={"cycle_id": cycle, "week_number": 1}).json()["code"]
    squat = make_exercise(bob, "Bob Squat", "Quadriceps")
    bobs = make_cycle(bob)
    for dow in (1, 4, 5):
        plan_day(bob, bobs, 1, dow, [("Quadriceps", squat, 3, "10")])
    body = {"code": code, "cycle_id": bobs, "week_number": 1}
    assert w(bob, "POST", "/plan-shares/import", json=body).status_code == 409
    r = w(bob, "POST", "/plan-shares/import", json={**body, "confirm_replace": True})
    assert r.status_code == 200 and r.json()["replaced_days"] == 3
    assert [day(bob, bobs, 1, d)["status"] for d in range(7)] == ["planned", "unplanned", "planned", "unplanned", "unplanned", "unplanned", "unplanned"]


def test_an_empty_target_needs_no_confirmation(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/week", json={"cycle_id": cycle, "week_number": 1}).json()["code"]
    assert w(bob, "POST", "/plan-shares/import", json={"code": code, "cycle_id": make_cycle(bob), "week_number": 1}).status_code == 200


def test_the_copy_belongs_to_the_importer_and_is_independent_of_the_original(alice_plan):
    (alice, bob, carol), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/week", json={"cycle_id": cycle, "week_number": 1}).json()["code"]
    bobs = make_cycle(bob)
    w(bob, "POST", "/plan-shares/import", json={"code": code, "cycle_id": bobs, "week_number": 1})
    assert w(bob, "DELETE", f"/cycles/{bobs}/weeks/1/days/0").status_code == 204        # Bob deletes his copy of Monday
    assert day(alice, cycle, 1, 0)["status"] == "planned"                                # Alice's Monday is untouched
    assert alice.get(f"{API}/cycles/{bobs}").status_code == 404 and carol.get(f"{API}/cycles/{bobs}").status_code == 404


def test_the_share_is_a_snapshot(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0}).json()["code"]
    w(alice, "DELETE", f"/cycles/{cycle}/weeks/1/days/0")                                # Alice then removes that day
    bobs = make_cycle(bob)
    assert w(bob, "POST", "/plan-shares/import", json={"code": code, "cycle_id": bobs, "week_number": 1, "day_of_week": 0}).status_code == 200
    assert len(summary(day(bob, bobs, 1, 0))[0]) == 3


def test_an_existing_library_exercise_is_reused_not_duplicated(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 2}).json()["code"]
    mine = make_exercise(bob, "ALICE BENCH", "Chest")
    bobs = make_cycle(bob)
    r = w(bob, "POST", "/plan-shares/import", json={"code": code, "cycle_id": bobs, "week_number": 1, "day_of_week": 0})
    assert r.status_code == 200 and r.json()["added_exercises"] == []
    assert day(bob, bobs, 1, 0)["strength"][0]["exercises"][0]["exercise"]["id"] == mine
    assert len(bob.get(f"{API}/exercises").json()["items"]) == 1


def test_a_completed_cycle_cannot_be_changed_by_an_import(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0}).json()["code"]
    bobs = make_cycle(bob)
    w(bob, "POST", f"/cycles/{bobs}/archive")
    r = w(bob, "POST", "/plan-shares/import", json={"code": code, "cycle_id": bobs, "week_number": 1, "day_of_week": 0})
    assert r.status_code == 409 and r.json()["error"]["code"] == "cycle_locked"


def test_you_cannot_import_into_someone_elses_cycle(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0}).json()["code"]
    bobs = make_cycle(bob)
    assert w(alice, "POST", "/plan-shares/import", json={"code": code, "cycle_id": bobs, "week_number": 1, "day_of_week": 0, "confirm_replace": True}).status_code == 404


# ----------------------------------------------------------------------------- codes and abuse

@pytest.mark.parametrize("bad", ["AAAAA-AAAAA", "1234", "'; DROP TABLE users;--"])
def test_wrong_codes_are_a_plain_404_and_change_nothing(alice_plan, bad):
    (alice, bob, _), cycle = alice_plan
    bobs = make_cycle(bob)
    for url in ("/plan-shares/preview", "/plan-shares/import"):
        r = w(bob, "POST", url, json={"code": bad, "cycle_id": bobs, "week_number": 1, "day_of_week": 0, "confirm_replace": True}) if url.endswith("import") \
            else w(bob, "POST", url, json={"code": bad})
        assert r.status_code in (404, 422)
    assert bob.get(f"{API}/exercises").json()["items"] == []


def test_expired_looks_like_wrong(alice_plan, session_factory):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0}).json()["code"]
    with session_factory() as db:
        share = db.scalars(select(PlanShare)).one()
        share.expires_at = utc_now_naive() - timedelta(seconds=1)
        db.commit()
    expired = w(bob, "POST", "/plan-shares/preview", json={"code": code})
    wrong = w(bob, "POST", "/plan-shares/preview", json={"code": "AAAAA-AAAAA"})
    assert expired.status_code == wrong.status_code == 404 and expired.json() == wrong.json()


def test_code_typing_is_forgiving(alice_plan):
    (alice, bob, _), cycle = alice_plan
    code = w(alice, "POST", "/plan-shares/day", json={"cycle_id": cycle, "week_number": 1, "day_of_week": 0}).json()["code"]
    for typed in (code.lower(), code.replace("-", ""), f" {code[:5]} {code[6:]} "):
        assert w(bob, "POST", "/plan-shares/preview", json={"code": typed}).status_code == 200


def test_trying_many_codes_is_rate_limited(alice_plan):
    (_, bob, _), _ = alice_plan
    statuses = [w(bob, "POST", "/plan-shares/preview", json={"code": f"AAAAA-{i:05d}".replace("0", "A")}).status_code for i in range(25)]
    assert statuses[0] == 404 and statuses[-1] == 429


def test_everything_needs_a_signed_in_user_and_csrf(alice_plan):
    (alice, _, _), cycle = alice_plan
    anon = TestClient(app, raise_server_exceptions=False)
    calls = (("/plan-shares/day", {"cycle_id": cycle, "week_number": 1, "day_of_week": 0}), ("/plan-shares/week", {"cycle_id": cycle, "week_number": 1}),
             ("/plan-shares/preview", {"code": "AAAAA-AAAAA"}),
             ("/plan-shares/import", {"code": "AAAAA-AAAAA", "cycle_id": cycle, "week_number": 1, "day_of_week": 0, "confirm_replace": True}))
    for url, body in calls:
        assert anon.post(API + url, json=body).status_code == 401
        assert alice.post(API + url, json=body).status_code == 403


def test_the_share_holds_names_only_never_ids_or_account_details(alice_plan, session_factory):
    (alice, _, _), cycle = alice_plan
    w(alice, "POST", "/plan-shares/week", json={"cycle_id": cycle, "week_number": 1})
    with session_factory() as db:
        text = str(db.scalars(select(PlanShare)).one().snapshot).lower()
    assert "alice@example.com" not in text and "exercise_id" not in text and "user_id" not in text and "cycle" not in text
