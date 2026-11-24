"""Admin-added catalogue exercises: shared with everyone, only the admin can add them or their pictures."""
import io

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import email_service

API = "/api/v1"
PW = "a-strong-test-password"
BODY = {"name": "Landmine Press", "muscle_group": "Shoulders", "target_area": "Front Delts", "equipment": "Landmine bar", "movement": "Press up and forward at an angle"}
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


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
    return sign_up("admin@example.com"), sign_up("user@example.com")


def w(c, method, url, **kw):
    return c.request(method, API + url, headers={"X-CSRF-Token": c.cookies.get("gp_csrf")}, **kw)


def test_only_the_admin_can_add_a_catalogue_exercise(people):
    admin, user = people
    assert w(user, "POST", "/exercise-catalogue", json=BODY).status_code == 403
    r = w(admin, "POST", "/exercise-catalogue", json=BODY)
    assert r.status_code == 201, r.text
    assert r.json()["key"] == "landmine-press" and r.json()["custom"] is True and r.json()["movement"] == BODY["movement"]


def test_everyone_sees_it_in_the_catalogue_with_its_details(people):
    admin, user = people
    w(admin, "POST", "/exercise-catalogue", json=BODY)
    for c in (admin, user):
        cat = c.get(f"{API}/exercise-catalogue").json()
        item = next(i for i in cat["items"] if i["key"] == "landmine-press")
        assert (item["muscle_group"], item["target_area"], item["equipment"], item["movement"], item["custom"]) == \
               ("Shoulders", "Front Delts", "Landmine bar", BODY["movement"], True)
        assert item["icon_motion"] in cat["motions"]
        assert next(i for i in cat["items"] if i["key"] == "barbell-bench-press")["custom"] is False


def test_pictures_and_videos_can_be_added_to_the_new_exercise_and_are_seen_by_all(people):
    admin, user = people
    w(admin, "POST", "/exercise-catalogue", json=BODY)
    files = [("files", ("a.png", io.BytesIO(PNG), "image/png")), ("files", ("v.mp4", io.BytesIO(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32), "video/mp4"))]
    r = w(admin, "POST", "/exercise-catalogue/landmine-press/media", files=files)
    assert r.status_code == 201 and [m["kind"] for m in r.json()] == ["image", "video"]       # picture first, video last
    item = next(i for i in user.get(f"{API}/exercise-catalogue").json()["items"] if i["key"] == "landmine-press")
    assert [m["kind"] for m in item["media"]] == ["image", "video"]
    assert w(user, "POST", "/exercise-catalogue/landmine-press/media", files=[("files", ("a.png", io.BytesIO(PNG), "image/png"))]).status_code == 403


def test_a_normal_user_can_add_it_to_their_own_library_and_to_a_set(people):
    admin, user = people
    w(admin, "POST", "/exercise-catalogue", json=BODY)
    added = w(user, "POST", "/exercise-catalogue/landmine-press/add")
    assert added.status_code == 201 and added.json()["name"] == "Landmine Press"
    assert w(admin, "GET", "/exercises").json()["items"] == []                     # (admin has not added it: libraries are separate)
    s = w(user, "POST", "/exercise-sets", json={"name": "Shoulders A", "muscle_group": "Shoulders", "exercise_keys": ["landmine-press"]})
    assert s.status_code == 201 and s.json()["exercises"][0]["name"] == "Landmine Press"
    assert user.get(f"{API}/exercise-sets").json()[0]["exercises"][0]["key"] == "landmine-press"


@pytest.mark.parametrize("change,code", [
    ({"muscle_group": "Not A Muscle"}, 422),
    ({"target_area": "Upper Chest"}, 422),                    # a real area, but of another muscle group
    ({"name": "Barbell Bench Press"}, 409),                   # already built in
    ({"name": "barbell bench press"}, 409),                   # ... in any letter case
    ({"name": "x"}, 422), ({"equipment": ""}, 422), ({"equipment": "   "}, 422), ({"name": "n" * 121}, 422),
    ({"surprise": 1}, 422),
])
def test_validation(people, change, code):
    admin, _ = people
    assert w(admin, "POST", "/exercise-catalogue", json={**BODY, **change}).status_code == code


def test_target_area_and_movement_are_optional_and_duplicates_are_refused(people):
    admin, _ = people
    r = w(admin, "POST", "/exercise-catalogue", json={"name": "Sled Push", "muscle_group": "Quadriceps", "equipment": "Sled"})
    assert r.status_code == 201 and r.json()["target_area"] is None and r.json()["movement"] is None
    assert w(admin, "POST", "/exercise-catalogue", json={"name": "SLED  push", "muscle_group": "Quadriceps", "equipment": "Sled"}).status_code == 409


def test_uploading_to_an_unknown_exercise_is_404(people):
    admin, _ = people
    assert w(admin, "POST", "/exercise-catalogue/nope/media", files=[("files", ("a.png", io.BytesIO(PNG), "image/png"))]).status_code == 404
