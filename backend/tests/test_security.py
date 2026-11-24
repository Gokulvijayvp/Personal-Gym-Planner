"""Security tests: every private endpoint, probed the way curl or Postman would.

Scenarios: no cookie, invalid cookie, expired session, revoked session, CSRF, CORS/Origin, rate limits,
owner lock (the single-user equivalent of "user A cannot reach user B"), admin guard, HTTP methods, headers.
"""
import re
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api import deps
from app.core import rate_limit
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.timezone import utc_now_naive
from app.main import create_app
from app.models.user import AuthSession
from app.services import email_service

API = "/api/v1"
SIGNUP_PW = "a-strong-test-password"
OWNER = "owner@example.com"
WRITES = ("post", "put", "patch", "delete")
# The ONLY routes reachable without a session. Anything else added later is private by default (see router.py).
PUBLIC = {
    ("get", f"{API}/health"),
    ("post", f"{API}/auth/signup/request-otp"),
    ("post", f"{API}/auth/signup/resend-otp"),
    ("post", f"{API}/auth/login/request-otp"),
    ("post", f"{API}/auth/login/password"),
    ("post", f"{API}/auth/verify-otp"),
    ("post", f"{API}/auth/logout"),
}


@pytest.fixture(autouse=True)
def _pinned_admin(monkeypatch):
    monkeypatch.setattr(settings, "admin_email", "owner@example.com")


@pytest.fixture
def sent(monkeypatch):
    codes: list[str] = []
    monkeypatch.setattr(email_service, "send_otp", lambda email, code, purpose: codes.append(code))
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)
    return codes


@pytest.fixture
def c(anon_client):
    return anon_client


@pytest.fixture
def operations(c):
    """Every (method, concrete path) the API documents, minus the public ones."""
    spec = c.get("/openapi.json").json()["paths"]
    ops = []
    for path, methods in spec.items():
        for m in methods:
            if m in ("get", "post", "put", "patch", "delete") and (m, path) not in PUBLIC:
                ops.append((m, re.sub(r"\{[^}]+\}", "1", path)))
    assert len(ops) > 60          # guard: the discovery itself must not silently find nothing
    return ops


def sign_in(c, sent, email=OWNER):
    assert c.post(f"{API}/auth/signup/request-otp", json={"email": email, "password": SIGNUP_PW}).status_code == 200
    r = c.post(f"{API}/auth/verify-otp", json={"email": email, "code": sent[-1]})
    assert r.status_code == 200, r.text
    return r


def csrf(c) -> dict:
    return {"X-CSRF-Token": c.cookies.get("gp_csrf")}


def probe(c, ops, headers=None):
    """Send each operation; return {(method, path): status}."""
    out = {}
    for m, p in ops:
        r = c.request(m.upper(), p, headers=headers, json={} if m != "get" else None)
        out[(m, p)] = r.status_code
    return out


# ----------------------------------------------------------------------------- A-D: sessions

def test_A_no_cookie_every_private_endpoint_is_401(c, operations):
    result = probe(c, operations)
    wrong = {k: v for k, v in result.items() if v != 401}
    assert not wrong, wrong
    assert {m for m, _ in operations} == set(WRITES) | {"get"}           # GET, POST, PUT, PATCH and DELETE were all covered


def test_B_invalid_cookie_every_private_endpoint_is_401(c, operations):
    for bad in ("garbage", "a" * 80, "' OR 1=1 --", ""):
        c.cookies.clear()
        c.cookies.set("gp_session", bad)
        wrong = {k: v for k, v in probe(c, operations, csrf_like()).items() if v != 401}
        assert not wrong, (bad, wrong)


def csrf_like():
    return {"X-CSRF-Token": "x"}


def test_C_expired_session_every_private_endpoint_is_401(c, sent, session_factory, operations):
    sign_in(c, sent)
    with session_factory() as db:
        row = db.scalars(select(AuthSession)).one()
        row.expires_at = utc_now_naive() - timedelta(seconds=1)
        db.commit()
    wrong = {k: v for k, v in probe(c, operations, csrf(c)).items() if v != 401}
    assert not wrong, wrong


def test_D_revoked_session_every_private_endpoint_is_401(c, sent, operations):
    sign_in(c, sent)
    stolen = c.cookies.get("gp_session")
    assert c.post(f"{API}/auth/logout").status_code == 204
    c.cookies.set("gp_session", stolen)               # the attacker replays the cookie they copied before logout
    wrong = {k: v for k, v in probe(c, operations, {"X-CSRF-Token": "x"}).items() if v != 401}
    assert not wrong, wrong


def test_a_valid_session_really_opens_the_private_api(c, sent):
    sign_in(c, sent)
    for path in ("/dashboard", "/exercise-sets", "/settings", "/workouts", "/exercises", "/calendar", "/progress/overview"):
        r = c.get(API + path)
        assert r.status_code in (200, 422), (path, r.status_code)       # reachable (a missing query parameter is not an auth failure)


# ----------------------------------------------------------------------------- owner lock (single-user "user A vs user B")



def test_E_a_stranger_cannot_sign_in_even_with_a_guessed_code(c, sent):
    sign_in(c, sent)
    c.cookies.clear()
    c.post(f"{API}/auth/login/request-otp", json={"email": "intruder@example.com"})
    for guess in ("000000", "123456", sent[-1]):                  # even the owner's real code does not work for another email
        r = c.post(f"{API}/auth/verify-otp", json={"email": "intruder@example.com", "code": guess})
        assert r.status_code == 400
    assert c.get(f"{API}/dashboard").status_code == 401






# ----------------------------------------------------------------------------- F: CSRF

def test_F_writes_without_a_csrf_token_are_rejected(c, sent, operations):
    sign_in(c, sent)
    writes = [(m, p) for m, p in operations if m in WRITES]
    wrong = {k: v for k, v in probe(c, writes).items() if v != 403}                 # no header at all
    assert not wrong, wrong


@pytest.mark.parametrize("make_headers", [
    lambda c: {"X-CSRF-Token": "not-the-token"},                                   # wrong value
    lambda c: {"X-CSRF-Token": ""},                                                # empty
])
def test_F_wrong_csrf_header_is_rejected(c, sent, make_headers):
    sign_in(c, sent)
    r = c.post(f"{API}/exercise-sets", json={"name": "Chest A", "muscle_group": "Chest", "exercise_keys": []}, headers=make_headers(c))
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"


def test_F_header_without_the_matching_cookie_is_rejected(c, sent):
    sign_in(c, sent)
    token = c.cookies.get("gp_csrf")
    c.cookies.delete("gp_csrf")                         # a cross-site page can send the session cookie but cannot know/forge this one
    r = c.delete(f"{API}/exercise-sets/1", headers={"X-CSRF-Token": token})
    assert r.status_code == 403


def test_F_a_token_from_another_session_is_rejected(c, sent, monkeypatch):
    sign_in(c, sent)
    mine = c.cookies.get("gp_csrf")
    other = TestClient(c.app, raise_server_exceptions=False)                        # a second browser, same account
    other.post(f"{API}/auth/login/request-otp", json={"email": OWNER})
    other.post(f"{API}/auth/verify-otp", json={"email": OWNER, "code": sent[-1]})
    theirs = other.cookies.get("gp_csrf")
    assert theirs and theirs != mine
    other.cookies.set("gp_csrf", mine)                                              # attacker swaps in the other session's token
    r = other.delete(f"{API}/exercise-sets/1", headers={"X-CSRF-Token": mine})
    assert r.status_code == 403


def test_F_a_valid_csrf_token_lets_the_write_through_and_reads_need_none(c, sent):
    sign_in(c, sent)
    assert c.get(f"{API}/exercise-sets").status_code == 200                         # GET: no token needed
    body = {"name": "Chest A", "muscle_group": "Chest", "exercise_keys": []}
    r = c.post(f"{API}/exercise-sets", json=body, headers=csrf(c))
    assert r.status_code in (201, 422), r.text
    assert r.json().get("error", {}).get("code") != "csrf_failed"


def test_F_get_requests_never_change_data(c, sent, operations):
    """Every GET operation is read-only: calling all of them leaves the database as it was."""
    sign_in(c, sent)
    # "database_size_bytes" is a whole-database measure that can change on its own (PostgreSQL housekeeping), so it is not data.
    # The row counts in the same response are what prove nothing was written.
    strip = lambda d: {k: v for k, v in d.items() if k != "database_size_bytes"}
    before = strip(c.get(f"{API}/settings/data").json())
    for m, p in operations:
        if m == "get" and "backup" not in p:
            c.get(p)
    assert strip(c.get(f"{API}/settings/data").json()) == before


# ----------------------------------------------------------------------------- G: CORS and Origin

def test_G_an_untrusted_origin_gets_no_credentialed_access(c, sent):
    sign_in(c, sent)
    pre = c.options(f"{API}/exercise-sets", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "DELETE"})
    assert pre.status_code == 400 and "access-control-allow-origin" not in pre.headers
    r = c.get(f"{API}/exercise-sets", headers={"Origin": "http://evil.example"})     # the browser would refuse to hand this to the page
    assert "access-control-allow-origin" not in r.headers       # without this header a browser never lets the evil page read the response


def test_G_a_trusted_origin_is_allowed_with_credentials_but_only_exactly(c):
    ok = c.options(f"{API}/exercise-sets", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
                                                    "Access-Control-Request-Headers": "x-csrf-token,content-type"})
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert ok.headers["access-control-allow-credentials"] == "true"
    assert "*" not in ok.headers["access-control-allow-origin"]
    for lookalike in ("http://localhost:5173.evil.example", "http://localhost:5174", "https://localhost:5173", "null"):
        bad = c.options(f"{API}/exercise-sets", headers={"Origin": lookalike, "Access-Control-Request-Method": "POST"})
        assert "access-control-allow-origin" not in bad.headers, lookalike


def test_G_preflight_is_never_a_business_operation(c):
    r = c.options(f"{API}/exercise-sets", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE"})
    assert r.status_code == 200 and r.content in (b"OK", b"")                       # no data, no session needed, nothing executed
    assert "TRACE" not in r.headers.get("access-control-allow-methods", "")


def test_G_writes_from_an_untrusted_origin_are_blocked_even_with_cookie_and_token(c, sent):
    sign_in(c, sent)
    body = {"name": "Chest A", "muscle_group": "Chest", "exercise_keys": []}
    for hdr in ({"Origin": "http://evil.example"}, {"Referer": "http://evil.example/page"}, {"Origin": "null"}):
        r = c.post(f"{API}/exercise-sets", json=body, headers={**csrf(c), **hdr})
        assert r.status_code == 403 and r.json()["error"]["code"] == "origin_not_allowed", hdr
    ok = c.post(f"{API}/exercise-sets", json=body, headers={**csrf(c), "Origin": "http://localhost:5173"})
    assert ok.status_code in (201, 422)


def test_G_a_wildcard_origin_list_is_refused(monkeypatch):
    monkeypatch.setattr(settings, "cors_origins", "https://app.example,*")
    with pytest.raises(RuntimeError, match="never"):
        create_app()


# ----------------------------------------------------------------------------- H: admin

def test_H_normal_users_cannot_use_admin_only_routes():
    mini = FastAPI()
    register_exception_handlers(mini)
    mini.add_api_route("/admin/thing", lambda user=Depends(deps.require_admin): {"ok": True}, methods=["GET"])
    for role, expected in (("user", 403), ("admin", 200)):
        mini.dependency_overrides[deps.get_current_user] = lambda role=role: SimpleNamespace(role=role)
        r = TestClient(mini).get("/admin/thing")
        assert r.status_code == expected, role


def test_H_only_the_first_account_is_admin_and_nobody_can_promote_themselves(c, sent, session_factory):
    from app.models.user import User
    sign_in(c, sent)                                                  # first account: admin
    other = TestClient(c.app, raise_server_exceptions=False)
    other.post(f"{API}/auth/signup/request-otp", json={"email": "second@example.com", "password": SIGNUP_PW})
    other.post(f"{API}/auth/verify-otp", json={"email": "second@example.com", "code": sent[-1]})
    with session_factory() as db:
        assert {u.email: u.role for u in db.scalars(select(User))} == {OWNER: "admin", "second@example.com": "user"}
    for body in ({"role": "admin"}, {"is_admin": True}):              # no endpoint accepts a role from the browser
        assert other.put(f"{API}/settings", json=body, headers={"X-CSRF-Token": other.cookies.get("gp_csrf")}).status_code in (422, 405, 404)
    assert other.get(f"{API}/auth/me").json()["role"] == "user"


def test_H_there_are_no_admin_or_management_endpoints_exposed(operations):
    assert not [p for _, p in operations if "/admin" in p or "/users" in p]


# ----------------------------------------------------------------------------- I: HTTP methods

@pytest.mark.parametrize("method,path", [
    ("DELETE", "/dashboard"), ("POST", "/calendar"), ("PUT", "/progress/overview"), ("PATCH", "/workouts/current"),
    ("POST", "/settings/data"), ("PUT", "/exercise-sets"), ("PATCH", "/exercise-sets"), ("DELETE", "/exercise-sets"),
    ("POST", "/auth/me"), ("PUT", "/health"),
])
def test_I_unsupported_methods_are_405_with_or_without_a_session(c, sent, method, path):
    anon = c.request(method, API + path)
    assert anon.status_code == 405, (method, path, anon.status_code)
    sign_in(c, sent)
    assert c.request(method, API + path, headers=csrf(c)).status_code == 405


def test_I_TRACE_and_CONNECT_style_methods_are_not_served(c):
    assert c.request("TRACE", f"{API}/dashboard").status_code in (405, 404)


# ----------------------------------------------------------------------------- rate limits

def test_rate_limit_otp_requests_per_email(c, sent):
    for _ in range(5):
        assert c.post(f"{API}/auth/signup/request-otp", json={"email": OWNER, "password": SIGNUP_PW}).status_code == 200
    r = c.post(f"{API}/auth/signup/request-otp", json={"email": OWNER, "password": SIGNUP_PW})
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert c.post(f"{API}/auth/login/request-otp", json={"email": "someone.else@example.com"}).status_code == 200   # other emails are unaffected


def test_rate_limit_otp_requests_per_ip_across_many_emails(c, sent):
    limit = settings.rate_otp_request_per_ip_hour                      # default 60 an hour per address (configurable)
    assert limit == 60
    for i in range(limit):
        assert c.post(f"{API}/auth/login/request-otp", json={"email": f"user{i}@example.com"}).status_code == 200
    assert c.post(f"{API}/auth/login/request-otp", json={"email": "user99@example.com"}).status_code == 429


def test_rate_limit_code_guessing_per_email(c, sent):
    c.post(f"{API}/auth/signup/request-otp", json={"email": OWNER, "password": SIGNUP_PW})
    codes = []
    for i in range(16):
        r = c.post(f"{API}/auth/verify-otp", json={"email": OWNER, "code": f"{i:06d}"})
        codes.append(r.status_code)
    assert codes[-1] == 429 and 429 in codes
    assert codes.count(200) == 0


def test_rate_limit_writes_per_session(c, sent, monkeypatch):
    monkeypatch.setattr(deps, "WRITES_PER_MINUTE", 3)
    sign_in(c, sent)
    statuses = [c.delete(f"{API}/exercise-sets/999", headers=csrf(c)).status_code for _ in range(5)]
    assert statuses[:3] == [404, 404, 404] and statuses[3:] == [429, 429]
    assert c.get(f"{API}/exercise-sets").status_code == 200                        # reads are not counted


def test_the_limiter_forgets_after_its_window(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now[0])
    rate_limit.hit("k", 2, 10); rate_limit.hit("k", 2, 10)
    with pytest.raises(Exception):
        rate_limit.hit("k", 2, 10)
    now[0] += 11
    rate_limit.hit("k", 2, 10)


# ----------------------------------------------------------------------------- headers, errors, docs, production

def test_security_headers_on_api_responses(c, sent):
    sign_in(c, sent)
    r = c.get(f"{API}/exercise-sets")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in r.headers                            # HTTPS-only header: production only
    e = c.get(f"{API}/nope")
    assert e.headers["x-content-type-options"] == "nosniff"


def test_error_responses_never_leak_internals(c, sent):
    sign_in(c, sent)
    for r in (c.get(f"{API}/exercises/not-a-number"), c.get(f"{API}/nope"), c.post(f"{API}/auth/verify-otp", content=b"{not json}", headers={"Content-Type": "application/json"})):
        text = r.text
        assert "Traceback" not in text and "sqlalchemy" not in text.lower() and settings.secret_key not in text


def test_secrets_never_appear_in_responses(c, sent):
    sign_in(c, sent)
    blob = "".join(c.get(f"{API}{p}").text for p in ("/settings", "/settings/data", "/auth/me", "/dashboard"))
    assert settings.secret_key not in blob and "gp_session" not in blob and c.cookies.get("gp_session") not in blob


def test_production_hides_docs_adds_hsts_and_refuses_unsafe_config(monkeypatch):
    with monkeypatch.context() as m:
        m.setattr(settings, "app_env", "production")
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            create_app()                                                           # default dev secret
        m.setattr(settings, "secret_key", "x" * 48)
        with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
            create_app()
        m.setattr(settings, "cookie_secure", True)
        with pytest.raises(RuntimeError, match="APP_DEBUG"):
            create_app()
        m.setattr(settings, "app_debug", False)
        with pytest.raises(RuntimeError, match="EMAIL_BACKEND"):
            create_app()                                                           # production must really email the codes
        m.setattr(settings, "email_backend", "resend")
        m.setattr(settings, "resend_api_key", "re_test_0123456789abcdefghijklmnop")
        m.setattr(settings, "resend_from_email", "Gym Planner <no-reply@example.com>")
        prod = TestClient(create_app(), raise_server_exceptions=False)
        assert prod.get("/docs").status_code == 404 and prod.get("/redoc").status_code == 404 and prod.get("/openapi.json").status_code == 404
        assert "max-age" in prod.get("/health").headers["strict-transport-security"]
        assert prod.get(f"{API}/dashboard").status_code == 401                     # still private


def test_the_secure_cookie_flag_is_set_when_configured(c, sent, monkeypatch):
    monkeypatch.setattr(settings, "cookie_secure", True)
    r = sign_in(c, sent)
    assert all("Secure" in x for x in r.headers.get_list("set-cookie"))


def test_health_and_root_reveal_nothing_private(c):
    for path in ("/health", f"{API}/health", "/"):
        body = c.get(path)
        assert body.status_code == 200
        assert not any(w in body.text.lower() for w in ("secret", "token", "email", "database", "path"))


# ----------------------------------------------------------------------------- default admin user







# ----------------------------------------------------------------------------- password sign-in

PW = "correct horse battery staple"          # a throwaway test password


@pytest.fixture
def admin(session_factory):
    """An account that has a password (as one created by sign-up would)."""
    from app.core.security import hash_password
    from app.models.user import User
    with session_factory() as db:
        db.add(User(email="admin@example.com", role="user", password_hash=hash_password(PW)))
        db.commit()


def test_passwords_are_stored_only_as_salted_hashes(admin, session_factory):
    from app.models.user import User
    with session_factory() as db:
        h = db.scalars(select(User).where(User.email == "admin@example.com")).one().password_hash
    assert h.startswith("scrypt$") and PW not in h
    from app.core.security import hash_password
    assert hash_password(PW) != hash_password(PW)                 # a fresh salt every time


def test_password_login_sets_the_session_cookies(c, admin):
    r = c.post(f"{API}/auth/login/password", json={"email": " Admin@Example.com ", "password": PW})
    assert r.status_code == 200 and r.json()["email"] == "admin@example.com"
    assert "password" not in r.text.lower().replace("password_hash", "")
    cookies = r.headers.get_list("set-cookie")
    assert any(x.startswith("gp_session=") and "HttpOnly" in x for x in cookies)
    assert c.get(f"{API}/dashboard").status_code == 200


def test_wrong_unknown_and_passwordless_accounts_get_the_same_answer(c, admin, session_factory):
    from app.models.user import User
    with session_factory() as db:
        db.add(User(email="codeonly@example.com", role="user")); db.commit()
    answers = [c.post(f"{API}/auth/login/password", json={"email": e, "password": p})
               for e, p in (("admin@example.com", "wrong"), ("nobody@example.com", PW), ("codeonly@example.com", PW), ("codeonly@example.com", ""))]
    assert [a.status_code for a in answers[:3]] == [401, 401, 401] and answers[3].status_code == 422
    assert len({a.text for a in answers[:3]}) == 1
    assert c.get(f"{API}/dashboard").status_code == 401


def test_password_guessing_is_rate_limited(c, admin):
    codes = [c.post(f"{API}/auth/login/password", json={"email": "admin@example.com", "password": f"guess{i}"}).status_code for i in range(7)]
    assert codes[:5] == [401] * 5 and codes[5:] == [429, 429]
    r = c.post(f"{API}/auth/login/password", json={"email": "admin@example.com", "password": PW})
    assert r.status_code == 429                                    # even the right password waits out the lockout


def test_password_login_from_an_untrusted_origin_is_blocked(c, admin):
    r = c.post(f"{API}/auth/login/password", json={"email": "admin@example.com", "password": PW}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403

