"""Exactly ONE permanent Admin, pinned to ADMIN_EMAIL: configuration, sign-up, the start-up check and the database guards."""
import logging
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.admin_state import inspect_admin_state, run_startup_check
from app.core.config import settings
from app.main import app
from app.models.user import User
from app.services import email_service

API = "/api/v1"
PW = "a-strong-test-password"
ADMIN = "admin@example.com"          # the default ADMIN_EMAIL in tests (see conftest)
DB_ERRORS = (IntegrityError, DBAPIError)


@pytest.fixture
def sent(monkeypatch):
    codes: list[tuple[str, str]] = []
    monkeypatch.setattr(email_service, "send_otp", lambda email, code, purpose: codes.append((email, code)))
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)
    return codes


def code_for(sent, email):
    return [x for e, x in sent if e.lower() == email.lower()][-1]


def sign_up(sent, email) -> TestClient:
    c = TestClient(app, raise_server_exceptions=False)
    r = c.post(f"{API}/auth/signup/request-otp", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    r = c.post(f"{API}/auth/verify-otp", json={"email": email, "code": code_for(sent, email)})
    assert r.status_code == 200, r.text
    return c


def roles(session_factory):
    with session_factory() as db:
        return {u.email: u.role for u in db.scalars(select(User))}


# ---------- configuration ----------
@pytest.mark.parametrize("value,ok", [("a@b.co", True), (" Admin@Example.COM ", True), (None, False), ("", False), ("   ", False),
                                      ("not-an-email", False), ("a@b", False), ("a b@c.com", False)])
def test_admin_email_validation(monkeypatch, value, ok):
    monkeypatch.setattr(settings, "admin_email", value)
    assert (settings.admin_email_problem() is None) is ok


def test_admin_email_is_normalised(monkeypatch):
    monkeypatch.setattr(settings, "admin_email", "  Boss@Example.COM ")
    assert settings.admin_email_normalised == "boss@example.com"


@pytest.mark.parametrize("value", [None, "", "nonsense"])
def test_production_refuses_to_start_without_a_valid_admin_email(monkeypatch, value):
    with monkeypatch.context() as m:
        m.setattr(settings, "app_env", "production")
        m.setattr(settings, "secret_key", "x" * 48)
        m.setattr(settings, "cookie_secure", True)
        m.setattr(settings, "app_debug", False)
        m.setattr(settings, "email_backend", "resend")
        m.setattr(settings, "resend_api_key", "re_test_0123456789abcdefghijklmnop")
        m.setattr(settings, "resend_from_email", "Gym Planner <no-reply@example.com>")
        m.setattr(settings, "admin_email", ADMIN)
        settings.check_production()                                   # fully configured: allowed
        m.setattr(settings, "admin_email", value)
        with pytest.raises(RuntimeError, match="ADMIN_EMAIL"):
            settings.check_production()


def test_development_without_admin_email_promotes_nobody_and_warns(anon_client, sent, monkeypatch, caplog, session_factory):
    monkeypatch.setattr(settings, "admin_email", None)
    caplog.set_level(logging.WARNING)
    sign_up(sent, ADMIN)
    assert roles(session_factory) == {ADMIN: "user"}
    run_startup_check(session_factory)
    assert "ADMIN_EMAIL is not set" in caplog.text


# ---------- who becomes the Admin ----------
def test_only_the_pinned_email_becomes_admin_whatever_the_order(anon_client, sent, session_factory):
    sign_up(sent, "first@example.com")                  # the first account is NOT the Admin any more
    sign_up(sent, "ADMIN@Example.com")                  # case does not matter
    sign_up(sent, "third@example.com")
    r = roles(session_factory)
    assert r["admin@example.com"] == "admin" and r["first@example.com"] == "user" and r["third@example.com"] == "user"
    assert sum(v == "admin" for v in r.values()) == 1


@pytest.mark.parametrize("path,body", [
    ("/auth/signup/request-otp", {"email": "x@example.com", "password": PW, "role": "admin"}),
    ("/auth/signup/request-otp", {"email": "x@example.com", "password": PW, "is_admin": True}),
    ("/auth/login/request-otp", {"email": "x@example.com", "role": "admin"}),
    ("/auth/verify-otp", {"email": "x@example.com", "code": "123456", "role": "admin"}),
    ("/auth/login/password", {"email": "x@example.com", "password": PW, "role": "admin"}),
])
def test_a_forged_role_or_unknown_field_is_rejected_with_422(anon_client, sent, session_factory, path, body):
    r = anon_client.post(f"{API}{path}", json=body)
    assert r.status_code == 422, r.text
    assert sent == [] and roles(session_factory) == {}  # nothing emailed, nothing created


# ---------- simultaneous requests ----------
def _race(n, fn):
    barrier = threading.Barrier(n)
    out = [None] * n

    def run(i):
        barrier.wait()
        try:
            out[i] = fn(i)
        except Exception as exc:                        # noqa: BLE001
            out[i] = exc
    ts = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return out


def test_simultaneous_sign_ups_create_at_most_one_admin(anon_client, sent, session_factory):
    emails = [ADMIN] + [f"u{i}@example.com" for i in range(7)]
    for e in emails:
        assert TestClient(app).post(f"{API}/auth/signup/request-otp", json={"email": e, "password": PW}).status_code == 200
    res = _race(len(emails), lambda i: TestClient(app, raise_server_exceptions=False)
                .post(f"{API}/auth/verify-otp", json={"email": emails[i], "code": code_for(sent, emails[i])}).status_code)
    assert all(r == 200 for r in res), res
    r = roles(session_factory)
    assert len(r) == 8 and sum(v == "admin" for v in r.values()) == 1 and r[ADMIN] == "admin"


def test_the_same_code_used_twice_at_once_signs_in_only_once(anon_client, sent, session_factory):
    TestClient(app).post(f"{API}/auth/signup/request-otp", json={"email": ADMIN, "password": PW})
    code = code_for(sent, ADMIN)
    res = _race(4, lambda i: TestClient(app, raise_server_exceptions=False)
                .post(f"{API}/auth/verify-otp", json={"email": ADMIN, "code": code}).status_code)
    assert res.count(200) == 1 and all(r in (200, 400, 409) for r in res), res
    assert list(roles(session_factory).values()).count("admin") == 1


def test_a_duplicate_email_is_answered_cleanly(anon_client, sent, session_factory):
    sign_up(sent, "dup@example.com")
    r = TestClient(app, raise_server_exceptions=False).post(f"{API}/auth/signup/request-otp", json={"email": "dup@example.com", "password": PW})
    assert r.status_code in (200, 409) and "Traceback" not in r.text
    assert list(roles(session_factory)).count("dup@example.com") == 1


# ---------- start-up consistency check ----------
def test_startup_check_reports_a_wrong_admin(session_factory, anon_client, sent, monkeypatch):
    sign_up(sent, ADMIN)
    with session_factory() as db:
        problems, _ = inspect_admin_state(db)
    assert problems == []
    monkeypatch.setattr(settings, "admin_email", "someone-else@example.com")
    with session_factory() as db:
        problems, warnings = inspect_admin_state(db)
    assert any("not the ADMIN_EMAIL" in p for p in problems) and any("not registered" in w for w in warnings)
    monkeypatch.setattr(settings, "app_env", "production")
    with pytest.raises(RuntimeError, match="Admin account check failed"):
        run_startup_check(session_factory)


def test_startup_check_in_development_only_logs(session_factory, anon_client, sent, monkeypatch, caplog):
    sign_up(sent, ADMIN)
    monkeypatch.setattr(settings, "admin_email", "someone-else@example.com")
    caplog.set_level(logging.ERROR)
    run_startup_check(session_factory)                  # does not raise in development
    assert "Admin account check failed" in caplog.text


# ---------- the database guards (SQLite triggers / PostgreSQL CHECK + trigger; partial unique index on both) ----------
def _exec(session_factory, sql, **params):
    with session_factory() as db:
        db.execute(text(sql), params)
        db.commit()


def test_database_refuses_a_second_admin(session_factory):
    with pytest.raises(DB_ERRORS):                      # session_factory already holds the one Admin (id 1)
        _exec(session_factory, "INSERT INTO users (email, role, created_at, updated_at) VALUES ('second-admin@example.com', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")


def test_database_refuses_promoting_a_user_to_a_second_admin(session_factory):
    _exec(session_factory, "INSERT INTO users (email, role, created_at, updated_at) VALUES ('plain@example.com', 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
    with pytest.raises(DB_ERRORS):
        _exec(session_factory, "UPDATE users SET role = 'admin' WHERE email = 'plain@example.com'")


@pytest.mark.parametrize("bad", ["superuser", "ADMIN", "", "root"])
def test_database_refuses_an_invalid_role(session_factory, bad):
    with pytest.raises(DB_ERRORS):
        _exec(session_factory, "INSERT INTO users (email, role, created_at, updated_at) VALUES ('bad@example.com', :r, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", r=bad)
    _exec(session_factory, "INSERT INTO users (email, role, created_at, updated_at) VALUES ('ok@example.com', 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
    with pytest.raises(DB_ERRORS):
        _exec(session_factory, "UPDATE users SET role = :r WHERE email = 'ok@example.com'", r=bad)


def test_database_refuses_to_demote_or_delete_the_admin(session_factory):
    with pytest.raises(DB_ERRORS):
        _exec(session_factory, "UPDATE users SET role = 'user' WHERE role = 'admin'")
    with pytest.raises(DB_ERRORS):
        _exec(session_factory, "DELETE FROM users WHERE role = 'admin'")
    assert list(roles(session_factory).values()).count("admin") == 1


def test_normal_users_can_still_be_changed_and_deleted(session_factory):
    _exec(session_factory, "INSERT INTO users (email, role, created_at, updated_at) VALUES ('temp@example.com', 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
    _exec(session_factory, "UPDATE users SET full_name = 'Temp' WHERE email = 'temp@example.com'")
    _exec(session_factory, "DELETE FROM users WHERE email = 'temp@example.com'")
    assert "temp@example.com" not in roles(session_factory)


# ---------- the migration itself (on a throwaway copy; works on SQLite and PostgreSQL) ----------
def _alembic(db_url, *args):
    import os
    import subprocess
    import sys
    from conftest import BACKEND
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env={**os.environ, "DATABASE_URL": db_url},
                          capture_output=True, text=True)


def _guard_names(session_factory):
    with session_factory() as db:
        if db.get_bind().dialect.name == "postgresql":
            rows = db.execute(text("SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_users%' AND NOT tgisinternal")).all()
            rows += db.execute(text("SELECT indexname FROM pg_indexes WHERE indexname = 'ux_users_single_admin'")).all()
            rows += db.execute(text("SELECT conname FROM pg_constraint WHERE conname = 'ck_users_role'")).all()
        else:
            rows = db.execute(text("SELECT name FROM sqlite_master WHERE name LIKE 'trg_users%' OR name = 'ux_users_single_admin'")).all()
        return {r[0] for r in rows}


def test_the_migration_round_trips_and_removes_everything_it_added(db_url, session_factory):
    assert _guard_names(session_factory)                                    # head has the guards
    r = _alembic(db_url, "downgrade", "c9d0e1f2a3b4")
    assert r.returncode == 0, r.stderr[-500:]
    assert _guard_names(session_factory) == set()
    r = _alembic(db_url, "upgrade", "head")
    assert r.returncode == 0, r.stderr[-500:]
    assert _guard_names(session_factory)
    assert roles(session_factory) == {"tester@example.com": "admin"}        # no row was touched


@pytest.mark.parametrize("setup", ["two_admins", "bad_role"])
def test_the_migration_stops_before_changing_anything_when_the_accounts_are_wrong(db_url, session_factory, setup):
    assert _alembic(db_url, "downgrade", "c9d0e1f2a3b4").returncode == 0
    stamp = "created_at, updated_at) VALUES ('{e}', '{r}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    sql = "INSERT INTO users (email, role, " + stamp
    _exec(session_factory, sql.format(e="second@example.com", r="admin" if setup == "two_admins" else "superuser"))
    r = _alembic(db_url, "upgrade", "head")
    assert r.returncode != 0 and "nothing was changed" in (r.stderr + r.stdout)
    assert _guard_names(session_factory) == set()                           # nothing was added
    assert len(roles(session_factory)) == 2                                 # and no account was changed or removed
