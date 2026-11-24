"""Sign-in flow: email code -> server-side session in httpOnly cookies -> sign out."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core import security
from app.core.config import settings
from app.core.timezone import utc_now_naive
from app.models.user import AuthSession, OtpCode, User
from app.services import email_service

API = "/api/v1"
SIGNUP_PW = "a-strong-test-password"
EMAIL = "me@example.com"


@pytest.fixture
def sent(monkeypatch):
    """Codes 'emailed' during the test, newest last."""
    codes: list[str] = []
    monkeypatch.setattr(email_service, "send_otp", lambda email, code, purpose: codes.append(code))
    return codes


@pytest.fixture
def c(anon_client, monkeypatch):
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)      # no waiting between requests unless a test turns it on
    return anon_client


def signup(c, sent, email=EMAIL, **extra):
    r = c.post(f"{API}/auth/signup/request-otp", json={"email": email, "password": SIGNUP_PW, **extra})
    assert r.status_code == 200, r.text
    return c.post(f"{API}/auth/verify-otp", json={"email": email, "code": sent[-1]})


def test_signup_sets_the_cookies_and_opens_the_api(c, sent):
    r = signup(c, sent, full_name="  Gokul ")
    assert r.status_code == 200
    assert r.json()["email"] == EMAIL and r.json()["full_name"] == "Gokul"
    raw = r.headers.get_list("set-cookie")
    session = next(x for x in raw if x.startswith("gp_session="))
    csrf = next(x for x in raw if x.startswith("gp_csrf="))
    assert "HttpOnly" in session and "SameSite=lax" in session and "Path=/" in session
    assert "HttpOnly" not in csrf                      # the page must read this one to send it back as a header
    assert c.get(f"{API}/auth/me").json()["email"] == EMAIL
    assert c.get(f"{API}/exercise-sets").status_code == 200
    assert not any(t in r.text for t in (c.cookies.get("gp_session"),))   # the session token is never in a response body


def test_only_a_hash_of_the_session_token_is_stored(c, sent, session_factory):
    signup(c, sent)
    token = c.cookies.get("gp_session")
    with session_factory() as db:
        row = db.scalars(select(AuthSession)).one()
        assert row.token_hash == security.hash_token(token) and token not in (row.token_hash, row.csrf_hash)


def test_the_code_is_stored_hashed_and_works_once(c, sent, session_factory):
    signup(c, sent)
    with session_factory() as db:
        row = db.scalars(select(OtpCode)).one()
        assert sent[-1] not in row.code_hash and row.consumed_at is not None
    again = c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": sent[-1]})
    assert again.status_code == 400 and again.json()["error"]["code"] == "otp_expired"


def test_wrong_code_then_lockout(c, sent):
    c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, "password": SIGNUP_PW})
    wrong = "000000" if sent[-1] != "000000" else "111111"
    for _ in range(settings.otp_max_attempts):
        r = c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": wrong})
        assert r.status_code == 400 and r.json()["error"]["code"] == "otp_invalid"
    r = c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": sent[-1]})     # even the right code is refused now
    assert r.status_code == 429 and r.json()["error"]["code"] == "otp_locked"


def test_expired_code(c, sent, session_factory):
    c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, "password": SIGNUP_PW})
    with session_factory() as db:
        row = db.scalars(select(OtpCode)).one()
        row.expires_at = utc_now_naive() - timedelta(minutes=1)
        db.commit()
    r = c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": sent[-1]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "otp_expired"


def test_resend_cooldown_and_a_new_code_replaces_the_old(c, sent, monkeypatch):
    monkeypatch.setattr(settings, "otp_resend_seconds", 60)
    assert c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, "password": SIGNUP_PW}).json()["resend_in_seconds"] == 60
    r = c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, "password": SIGNUP_PW})
    assert r.status_code == 429 and r.json()["error"]["code"] == "otp_cooldown" and "retry-after" in r.headers
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)
    c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, "password": SIGNUP_PW})
    old, new = sent[0], sent[1]
    if old != new:
        assert c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": old}).status_code == 400
    assert c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": new}).status_code == 200


def test_login_works_for_the_owner_and_normalises_the_email(c, sent):
    signup(c, sent)
    c.cookies.clear()
    assert c.post(f"{API}/auth/login/request-otp", json={"email": f" {EMAIL.upper()} "}).status_code == 200
    assert c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": sent[-1]}).status_code == 200
    assert c.get(f"{API}/auth/me").status_code == 200


def test_login_for_an_unknown_email_looks_exactly_like_success_and_sends_nothing(c, sent):
    signup(c, sent)
    c.cookies.clear()
    known = c.post(f"{API}/auth/login/request-otp", json={"email": EMAIL})
    n = len(sent)
    unknown = c.post(f"{API}/auth/login/request-otp", json={"email": "stranger@example.com"})
    assert unknown.status_code == known.status_code == 200 and unknown.json() == known.json()
    assert len(sent) == n                              # nothing was sent, and nobody learns that the email is unregistered
    r = c.post(f"{API}/auth/verify-otp", json={"email": "stranger@example.com", "code": "123456"})
    assert r.status_code == 400


def test_validation(c, sent):
    assert c.post(f"{API}/auth/login/request-otp", json={"email": "nope"}).status_code == 422
    assert c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": "12"}).status_code == 422
    assert c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, "password": SIGNUP_PW, "phone": ""}).status_code == 200   # blank phone is fine
    assert sent


def test_me_repairs_a_lost_csrf_cookie(c, sent):
    signup(c, sent)
    c.cookies.delete("gp_csrf")
    r = c.get(f"{API}/auth/me")
    assert r.status_code == 200 and c.cookies.get("gp_csrf")
    assert c.post(f"{API}/exercise-sets", json={"name": "Chest A", "muscle_group": "Chest", "exercise_keys": []},
                  headers={"X-CSRF-Token": c.cookies.get("gp_csrf")}).status_code in (201, 422)


def test_logout_ends_the_session_at_once_and_clears_the_cookies(c, sent, session_factory):
    signup(c, sent)
    token = c.cookies.get("gp_session")
    r = c.post(f"{API}/auth/logout")
    assert r.status_code == 204
    assert all("Max-Age=0" in x or "expires" in x.lower() for x in r.headers.get_list("set-cookie"))
    with session_factory() as db:
        assert db.scalars(select(AuthSession)).one().revoked_at is not None
    c.cookies.set("gp_session", token)                  # replaying the old cookie value does nothing: the server has revoked it
    assert c.get(f"{API}/auth/me").status_code == 401
    assert c.post(f"{API}/auth/logout").status_code == 204        # logging out twice is harmless


def test_sessions_slide_with_use_but_have_an_absolute_end(c, sent, session_factory):
    signup(c, sent)
    with session_factory() as db:
        row = db.scalars(select(AuthSession)).one()
        row.last_seen_at = utc_now_naive() - timedelta(hours=1)
        row.expires_at = utc_now_naive() + timedelta(days=1)
        db.commit()
    assert c.get(f"{API}/auth/me").status_code == 200
    with session_factory() as db:
        row = db.scalars(select(AuthSession)).one()
        assert row.expires_at > utc_now_naive() + timedelta(days=settings.session_days - 1)        # renewed by use
        row.created_at = utc_now_naive() - timedelta(days=settings.session_max_days + 1)           # but never forever
        db.commit()
    assert c.get(f"{API}/auth/me").status_code == 401


def test_a_session_for_a_deleted_user_is_refused(c, sent, session_factory):
    signup(c, sent)
    with session_factory() as db:
        db.delete(db.scalars(select(User)).one())
        db.commit()
    assert c.get(f"{API}/auth/me").status_code == 401


def test_a_real_server_will_not_pretend_to_send_email(c, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "email_backend", "console")          # console is development-only, so production refuses it
    r = c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, "password": SIGNUP_PW})
    assert r.status_code == 503 and r.json()["error"]["code"] == "email_unavailable"


# ----------------------------------------------------------------------------- sign-up asks for a password first

def test_signup_needs_a_password(c, sent):
    for bad, why in (({}, "missing"), ({"password": "short"}, "too short"), ({"password": "        "}, "spaces only"),
                     ({"password": EMAIL}, "same as the email"), ({"password": "x" * 129}, "too long")):
        r = c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, **bad})
        assert r.status_code == 422, why
    assert not sent                                                  # no code is sent until the password is acceptable


def test_the_password_chosen_at_signup_works_for_later_logins_and_the_code_still_does_too(c, sent, session_factory):
    signup(c, sent)
    c.post(f"{API}/auth/logout")
    c.cookies.clear()
    # 1) password login
    assert c.post(f"{API}/auth/login/password", json={"email": EMAIL, "password": SIGNUP_PW}).status_code == 200
    assert c.get(f"{API}/dashboard").status_code == 200
    c.post(f"{API}/auth/logout"); c.cookies.clear()
    assert c.post(f"{API}/auth/login/password", json={"email": EMAIL, "password": "wrong-password"}).status_code == 401
    # 2) emailed-code login
    assert c.post(f"{API}/auth/login/request-otp", json={"email": EMAIL}).status_code == 200
    assert c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": sent[-1]}).status_code == 200


def test_no_account_and_no_password_until_the_email_is_verified(c, sent, session_factory):
    c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, "password": SIGNUP_PW})
    with session_factory() as db:
        assert db.scalars(select(User)).all() == []                  # nothing is created before the code is entered
        pending = db.scalars(select(OtpCode)).one()
        assert pending.password_hash.startswith("scrypt$") and SIGNUP_PW not in pending.password_hash
    assert c.post(f"{API}/auth/login/password", json={"email": EMAIL, "password": SIGNUP_PW}).status_code == 401
    c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": sent[-1]})
    with session_factory() as db:
        assert db.scalars(select(User)).one().password_hash.startswith("scrypt$")
        assert db.scalars(select(OtpCode)).one().password_hash is None        # wiped from the code row once used


def test_resending_a_signup_code_keeps_the_password_on_the_server(c, sent, session_factory):
    c.post(f"{API}/auth/signup/request-otp", json={"email": EMAIL, "password": SIGNUP_PW, "full_name": "Gokul"})
    first = sent[-1]
    r = c.post(f"{API}/auth/signup/resend-otp", json={"email": EMAIL})            # no password sent again
    assert r.status_code == 200 and len(sent) == 2
    if first != sent[-1]:
        assert c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": first}).status_code == 400   # the old code is dead
    assert c.post(f"{API}/auth/verify-otp", json={"email": EMAIL, "code": sent[-1]}).status_code == 200
    c.post(f"{API}/auth/logout"); c.cookies.clear()
    assert c.post(f"{API}/auth/login/password", json={"email": EMAIL, "password": SIGNUP_PW}).status_code == 200   # the original password still works
    with session_factory() as db:
        assert db.scalars(select(User)).one().full_name == "Gokul"


def test_resend_without_a_started_signup_is_refused(c, sent):
    r = c.post(f"{API}/auth/signup/resend-otp", json={"email": EMAIL})
    assert r.status_code == 400 and r.json()["error"]["code"] == "signup_expired" and not sent
