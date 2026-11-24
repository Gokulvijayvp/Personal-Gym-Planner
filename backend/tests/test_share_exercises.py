"""Share "My exercises" with a code: one person copies the code, another pastes it and (after confirming) their list is replaced."""
import re
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.core.timezone import utc_now_naive
from app.main import app
from app.models.exercise_set_share import ExerciseSetShare
from app.services import email_service

API = "/api/v1"
PW = "a-strong-test-password"


@pytest.fixture(autouse=True)
def _pinned_admin(monkeypatch):
    monkeypatch.setattr(settings, "admin_email", "alice@example.com")


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


def mk_set(c, name, group, keys):
    r = w(c, "POST", "/exercise-sets", json={"name": name, "muscle_group": group, "exercise_keys": keys})
    assert r.status_code == 201, r.text
    return r.json()


def names(c):
    return sorted(s["name"] for s in c.get(f"{API}/exercise-sets").json())


@pytest.fixture
def alice_with_sets(people):
    alice, bob, carol = people
    mk_set(alice, "Chest A", "Chest", ["barbell-bench-press", "dumbbell-fly"])
    mk_set(alice, "Chest B", "Chest", ["push-ups"])
    return people


def test_share_makes_a_readable_unique_code_for_the_whole_list(alice_with_sets):
    alice, bob, _ = alice_with_sets
    r = w(alice, "POST", "/exercise-sets/share")
    assert r.status_code == 201, r.text
    assert re.fullmatch(r"[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}", r.json()["code"])       # no look-alike characters
    assert r.json()["sets_count"] == 2
    assert w(alice, "POST", "/exercise-sets/share").json()["code"] != r.json()["code"]   # every share gets its own code


def test_nothing_to_share_when_the_list_is_empty(people):
    alice, _, _ = people
    r = w(alice, "POST", "/exercise-sets/share")
    assert r.status_code == 400 and r.json()["error"]["code"] == "nothing_to_share"


def test_preview_shows_what_would_be_imported_without_changing_anything(alice_with_sets):
    alice, bob, _ = alice_with_sets
    mk_set(bob, "My own", "Chest", ["push-ups"])
    code = w(alice, "POST", "/exercise-sets/share").json()["code"]
    r = w(bob, "POST", "/exercise-sets/shared/preview", json={"code": code})
    assert r.status_code == 200
    assert r.json()["sets_count"] == 2
    assert {(s["name"], s["exercise_count"]) for s in r.json()["sets"]} == {("Chest A", 2), ("Chest B", 1)}
    assert names(bob) == ["My own"]                                                      # nothing changed yet


def test_importing_needs_confirmation_then_replaces_the_whole_list(alice_with_sets):
    alice, bob, _ = alice_with_sets
    mk_set(bob, "Old A", "Chest", ["push-ups"])
    mk_set(bob, "Old B", "Chest", ["dumbbell-fly"])
    code = w(alice, "POST", "/exercise-sets/share").json()["code"]
    no = w(bob, "POST", "/exercise-sets/import", json={"code": code})                   # no confirmation sent
    assert no.status_code == 422 and no.json()["error"]["code"] == "confirmation_required"
    no2 = w(bob, "POST", "/exercise-sets/import", json={"code": code, "confirm_replace": False})
    assert no2.status_code == 422
    assert names(bob) == ["Old A", "Old B"]                                              # still untouched
    r = w(bob, "POST", "/exercise-sets/import", json={"code": code, "confirm_replace": True})
    assert r.status_code == 200, r.text
    assert (r.json()["removed"], r.json()["imported"]) == (2, 2)
    assert names(bob) == ["Chest A", "Chest B"]                                          # old ones are gone, shared ones are in
    chest_a = next(s for s in bob.get(f"{API}/exercise-sets").json() if s["name"] == "Chest A")
    assert [e["key"] for e in chest_a["exercises"]] == ["barbell-bench-press", "dumbbell-fly"]     # same exercises, same order


def test_the_copy_belongs_to_the_importer_and_the_original_owner_is_untouched(alice_with_sets):
    alice, bob, carol = alice_with_sets
    code = w(alice, "POST", "/exercise-sets/share").json()["code"]
    w(bob, "POST", "/exercise-sets/import", json={"code": code, "confirm_replace": True})
    assert names(alice) == ["Chest A", "Chest B"] and names(bob) == ["Chest A", "Chest B"]
    bobs_id = next(s["id"] for s in bob.get(f"{API}/exercise-sets").json() if s["name"] == "Chest A")
    alices_id = next(s["id"] for s in alice.get(f"{API}/exercise-sets").json() if s["name"] == "Chest A")
    assert bobs_id != alices_id                                                          # a real copy, not the same rows
    assert w(bob, "DELETE", f"/exercise-sets/{bobs_id}").status_code == 204
    assert names(alice) == ["Chest A", "Chest B"]                                        # Bob deleting his copy does not touch Alice's
    assert carol.get(f"{API}/exercise-sets").json() == []


def test_the_share_is_a_snapshot_later_edits_do_not_change_it(alice_with_sets):
    alice, bob, _ = alice_with_sets
    code = w(alice, "POST", "/exercise-sets/share").json()["code"]
    for s in alice.get(f"{API}/exercise-sets").json():
        w(alice, "DELETE", f"/exercise-sets/{s['id']}")
    mk_set(alice, "Brand new", "Chest", ["push-ups"])
    r = w(bob, "POST", "/exercise-sets/import", json={"code": code, "confirm_replace": True})
    assert r.status_code == 200 and names(bob) == ["Chest A", "Chest B"]                 # what Alice had when she shared


def test_the_code_is_forgiving_about_case_spaces_and_the_dash(alice_with_sets):
    alice, bob, _ = alice_with_sets
    code = w(alice, "POST", "/exercise-sets/share").json()["code"]
    for typed in (code.lower(), code.replace("-", ""), f"  {code[:5]} {code[6:]}  ", code.replace("-", " - ")):
        assert w(bob, "POST", "/exercise-sets/shared/preview", json={"code": typed}).status_code == 200, typed


@pytest.mark.parametrize("bad", ["AAAAA-AAAAA", "1234", "not a code!!", "'; DROP TABLE users;--"])
def test_a_wrong_code_is_a_plain_404_that_changes_nothing(alice_with_sets, bad):
    alice, bob, _ = alice_with_sets
    mk_set(bob, "Mine", "Chest", ["push-ups"])
    for url in ("/exercise-sets/shared/preview", "/exercise-sets/import"):
        r = w(bob, "POST", url, json={"code": bad, "confirm_replace": True})
        assert r.status_code in (404, 422), (url, r.status_code)
        if r.status_code == 404:
            assert r.json()["error"]["code"] == "share_code_invalid"
    assert names(bob) == ["Mine"]


def test_an_expired_code_looks_exactly_like_a_wrong_one(alice_with_sets, session_factory):
    alice, bob, _ = alice_with_sets
    code = w(alice, "POST", "/exercise-sets/share").json()["code"]
    with session_factory() as db:
        share = db.scalars(select(ExerciseSetShare)).one()
        share.expires_at = utc_now_naive() - timedelta(seconds=1)
        db.commit()
    expired = w(bob, "POST", "/exercise-sets/shared/preview", json={"code": code})
    wrong = w(bob, "POST", "/exercise-sets/shared/preview", json={"code": "AAAAA-AAAAA"})
    assert expired.status_code == wrong.status_code == 404 and expired.json() == wrong.json()


def test_a_share_with_nothing_usable_never_wipes_your_list(alice_with_sets, session_factory):
    alice, bob, _ = alice_with_sets
    mk_set(bob, "Keep me", "Chest", ["push-ups"])
    code = w(alice, "POST", "/exercise-sets/share").json()["code"]
    with session_factory() as db:                                                        # every exercise in the share has since left the catalogue
        share = db.scalars(select(ExerciseSetShare)).one()
        share.snapshot = [{"name": "Ghost", "muscle_group": "Chest", "exercise_keys": ["no-such-exercise"]}]
        db.commit()
    r = w(bob, "POST", "/exercise-sets/import", json={"code": code, "confirm_replace": True})
    assert r.status_code == 422 and r.json()["error"]["code"] == "nothing_to_import"
    assert names(bob) == ["Keep me"]


def test_you_can_restore_your_own_list_from_your_own_code(alice_with_sets):
    alice, _, _ = alice_with_sets
    code = w(alice, "POST", "/exercise-sets/share").json()["code"]
    for s in alice.get(f"{API}/exercise-sets").json():
        w(alice, "DELETE", f"/exercise-sets/{s['id']}")
    assert alice.get(f"{API}/exercise-sets").json() == []
    assert w(alice, "POST", "/exercise-sets/import", json={"code": code, "confirm_replace": True}).status_code == 200
    assert names(alice) == ["Chest A", "Chest B"]


def test_a_set_with_an_admin_added_exercise_can_be_shared(alice_with_sets):
    alice, bob, _ = alice_with_sets                                                      # Alice (first sign-up) is the admin
    assert w(alice, "POST", "/exercise-catalogue", json={"name": "Landmine Press", "muscle_group": "Shoulders", "equipment": "Landmine bar"}).status_code == 201
    mk_set(alice, "Shoulders A", "Shoulders", ["landmine-press"])
    code = w(alice, "POST", "/exercise-sets/share").json()["code"]
    assert w(bob, "POST", "/exercise-sets/import", json={"code": code, "confirm_replace": True}).status_code == 200
    shoulders = next(s for s in bob.get(f"{API}/exercise-sets").json() if s["name"] == "Shoulders A")
    assert shoulders["exercises"][0]["name"] == "Landmine Press"


def test_trying_many_codes_is_rate_limited(alice_with_sets):
    _, bob, _ = alice_with_sets
    statuses = [w(bob, "POST", "/exercise-sets/shared/preview", json={"code": f"AAAAA-{i:05d}".replace("0", "A")}).status_code for i in range(25)]
    assert statuses[0] == 404 and statuses[-1] == 429


def test_sharing_needs_a_signed_in_user_and_the_csrf_token(alice_with_sets):
    alice, _, _ = alice_with_sets
    anon = TestClient(app, raise_server_exceptions=False)
    for url, body in (("/exercise-sets/share", None), ("/exercise-sets/shared/preview", {"code": "AAAAA-AAAAA"}),
                      ("/exercise-sets/import", {"code": "AAAAA-AAAAA", "confirm_replace": True})):
        assert anon.post(API + url, json=body).status_code == 401
        assert alice.post(API + url, json=body).status_code == 403                       # signed in, but no CSRF header


def test_the_share_table_holds_no_personal_data(alice_with_sets, session_factory):
    alice, _, _ = alice_with_sets
    w(alice, "POST", "/exercise-sets/share")
    with session_factory() as db:
        share = db.scalars(select(ExerciseSetShare)).one()
        assert set(share.snapshot[0]) == {"name", "muscle_group", "exercise_keys"}
        assert "alice" not in str(share.snapshot).lower()
