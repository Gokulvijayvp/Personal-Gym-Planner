"""A normal user (anyone who is not ADMIN_EMAIL): sign-up, email-code login, password login, their OWN Settings,
and no access to Admin-only features. Also: a legacy account (like Account 2) logs in by both methods."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core import rate_limit
from app.core.config import settings
from app.core.security import hash_password
from app.main import app
from app.models.user import User
from app.services import email_service

API = "/api/v1"
PW = "a-strong-test-password"
ADMIN = "admin@example.com"
USER = "someone@example.com"
BODY = {"name": "Landmine Press", "muscle_group": "Shoulders", "target_area": "Front Delts", "equipment": "Landmine bar", "movement": "Press"}
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def sent(monkeypatch):
    codes: list[tuple[str, str]] = []
    monkeypatch.setattr(email_service, "send_otp", lambda email, code, purpose: codes.append((email, code)))
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)
    return codes


def last_code(sent, email):
    return [c for e, c in sent if e.lower() == email.lower()][-1]


def sign_up(sent, email):
    c = TestClient(app, raise_server_exceptions=False)
    assert c.post(f"{API}/auth/signup/request-otp", json={"email": email, "password": PW}).status_code == 200
    r = c.post(f"{API}/auth/verify-otp", json={"email": email, "code": last_code(sent, email)})
    assert r.status_code == 200, r.text
    return c


def w(c, method, url, **kw):
    return c.request(method, API + url, headers={"X-CSRF-Token": c.cookies.get("gp_csrf")}, **kw)


@pytest.fixture
def people(anon_client, sent):
    return sign_up(sent, ADMIN), sign_up(sent, USER)


# ---------- sign-up, email-code login, password login ----------
def test_a_new_user_signs_up_as_a_normal_user(anon_client, sent, session_factory):
    c = sign_up(sent, USER)
    me = c.get(f"{API}/auth/me").json()
    assert me["role"] == "user" and me["email"] == USER
    with session_factory() as db:
        assert db.scalars(select(User).where(User.email == USER)).one().role == "user"


def test_a_normal_user_logs_in_by_email_code(anon_client, sent):
    sign_up(sent, USER)
    c = TestClient(app, raise_server_exceptions=False)
    assert c.post(f"{API}/auth/login/request-otp", json={"email": USER}).status_code == 200
    r = c.post(f"{API}/auth/verify-otp", json={"email": USER, "code": last_code(sent, USER)})
    assert r.status_code == 200 and c.get(f"{API}/auth/me").json()["role"] == "user"


def test_a_normal_user_logs_in_by_password(anon_client, sent):
    sign_up(sent, USER)
    c = TestClient(app, raise_server_exceptions=False)
    assert c.post(f"{API}/auth/login/password", json={"email": USER, "password": "wrong-password-123"}).status_code in (400, 401)
    r = c.post(f"{API}/auth/login/password", json={"email": USER, "password": PW})
    assert r.status_code == 200, r.text
    assert c.get(f"{API}/auth/me").json()["role"] == "user"


def test_an_existing_account_with_a_password_logs_in_both_ways(anon_client, sent, session_factory):
    """Like Account 2: created earlier, a normal user, a stored password hash."""
    with session_factory() as db:
        db.add(User(email="legacy@example.com", role="user", password_hash=hash_password(PW)))
        db.commit()
    c = TestClient(app, raise_server_exceptions=False)
    assert c.post(f"{API}/auth/login/password", json={"email": "legacy@example.com", "password": PW}).status_code == 200
    assert c.get(f"{API}/auth/me").json()["role"] == "user"
    rate_limit.reset()
    c2 = TestClient(app, raise_server_exceptions=False)
    assert c2.post(f"{API}/auth/login/request-otp", json={"email": "legacy@example.com"}).status_code == 200
    assert c2.post(f"{API}/auth/verify-otp", json={"email": "legacy@example.com", "code": last_code(sent, "legacy@example.com")}).status_code == 200
    assert c2.get(f"{API}/auth/me").json()["role"] == "user"


# ---------- own Settings ----------
def _editable(c):
    d = c.get(f"{API}/settings").json()
    d.pop("updated_at")
    return d


def test_a_normal_user_reads_changes_and_resets_their_own_settings(people):
    _, user = people
    body = {**_editable(user), "weight_unit": "lbs", "display_name": "Sam"}
    r = w(user, "PUT", "/settings", json=body)
    assert r.status_code == 200, r.text
    assert user.get(f"{API}/settings").json()["weight_unit"] == "lbs"
    assert w(user, "POST", "/settings/reset", json={"section": "personal"}).status_code == 200


def test_settings_are_per_user(people):
    admin, user = people
    before = admin.get(f"{API}/settings").json()["weight_unit"]
    other = "lbs" if before == "kg" else "kg"
    assert w(user, "PUT", "/settings", json={**_editable(user), "weight_unit": other}).status_code == 200
    assert admin.get(f"{API}/settings").json()["weight_unit"] == before       # the other person's choice did not change mine
    assert user.get(f"{API}/settings").json()["weight_unit"] == other


def test_data_info_gives_a_normal_user_only_their_own_counts(people):
    admin, user = people
    d = user.get(f"{API}/settings/data").json()
    assert set(d["counts"]) == {"exercises", "cycles", "planned_days", "workout_sessions"}
    assert d["application"] is None and d["database_engine"] is None and d["schema_version"] is None
    assert d["database_size_bytes"] is None and d["backup_includes"] == []
    assert "path" not in str(d).lower()
    a = admin.get(f"{API}/settings/data").json()
    assert a["application"] and a["database_engine"] and a["backup_includes"]


# ---------- Admin-only features are denied ----------
def test_a_normal_user_cannot_download_the_backup(people):
    admin, user = people
    assert user.get(f"{API}/settings/data/backup").status_code == 403
    assert admin.get(f"{API}/settings/data/backup").status_code != 403        # (PostgreSQL answers 400: its backup is pg_dump)


def test_a_normal_user_cannot_add_catalogue_exercises_or_pictures(people):
    admin, user = people
    assert w(user, "POST", "/exercise-catalogue", json=BODY).status_code == 403
    assert w(admin, "POST", "/exercise-catalogue", json=BODY).status_code == 201
    assert w(user, "POST", "/exercise-catalogue/landmine-press/media", files={"files": ("a.png", PNG, "image/png")}).status_code == 403
    assert w(user, "DELETE", "/exercise-catalogue/media/1").status_code == 403


def test_a_normal_user_cannot_edit_the_shared_exercise_list(people):
    _, user = people
    assert w(user, "POST", "/exercise-masters", json={"name": "X", "muscle_group": "Chest"}).status_code == 403
    assert w(user, "PUT", "/exercise-masters/1", json={"name": "X", "muscle_group": "Chest"}).status_code == 403
    assert w(user, "DELETE", "/exercise-masters/1").status_code == 403


def test_the_role_in_the_session_cannot_be_changed_through_settings(people, session_factory):
    _, user = people
    for body in ({"role": "admin"}, {"is_admin": True}):
        assert w(user, "PUT", "/settings", json={**_editable(user), **body}).status_code == 422
    assert user.get(f"{API}/auth/me").json()["role"] == "user"
    with session_factory() as db:
        assert db.scalars(select(User).where(User.email == USER)).one().role == "user"


# ---------- data isolation still holds ----------
def test_one_users_exercises_are_invisible_to_the_other(people):
    admin, user = people
    cat = user.get(f"{API}/exercise-catalogue").json()
    key = (cat["items"] if isinstance(cat, dict) and "items" in cat else cat)[0]["key"]
    assert w(user, "POST", f"/exercise-catalogue/{key}/add").status_code == 201
    assert len(user.get(f"{API}/exercises").json()["items"]) == 1
    assert admin.get(f"{API}/exercises").json()["items"] == []
