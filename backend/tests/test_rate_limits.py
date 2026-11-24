"""Rate limits: configurable per-IP defaults, unchanged per-email limits, and counters that do not pile up in memory."""
import pytest
from fastapi.testclient import TestClient

from app.core import rate_limit
from app.core.config import Settings, settings
from app.core.errors import AppError
from app.main import app
from app.services import email_service

API = "/api/v1"


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(email_service, "send_otp", lambda email, code, purpose: None)
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)


def test_the_default_limits():
    s = Settings(_env_file=None)
    assert (s.rate_otp_request_per_ip_hour, s.rate_verify_per_ip_15min, s.rate_password_per_ip_15min) == (60, 150, 100)
    assert (s.rate_otp_request_per_email_hour, s.rate_verify_per_email_15min, s.rate_password_per_email_15min) == (5, 15, 5)


def test_the_limits_can_be_set_from_the_environment(monkeypatch):
    monkeypatch.setenv("RATE_OTP_REQUEST_PER_IP_HOUR", "7")
    monkeypatch.setenv("RATE_VERIFY_PER_IP_15MIN", "9")
    monkeypatch.setenv("RATE_PASSWORD_PER_IP_15MIN", "11")
    s = Settings(_env_file=None)
    assert (s.rate_otp_request_per_ip_hour, s.rate_verify_per_ip_15min, s.rate_password_per_ip_15min) == (7, 9, 11)


def test_the_per_ip_otp_limit_follows_the_setting(anon_client, monkeypatch):
    monkeypatch.setattr(settings, "rate_otp_request_per_ip_hour", 3)
    c = TestClient(app, raise_server_exceptions=False)
    for i in range(3):
        assert c.post(f"{API}/auth/login/request-otp", json={"email": f"u{i}@example.com"}).status_code == 200
    assert c.post(f"{API}/auth/login/request-otp", json={"email": "u9@example.com"}).status_code == 429


def test_the_per_ip_verify_and_password_limits_follow_the_settings(anon_client, monkeypatch):
    monkeypatch.setattr(settings, "rate_verify_per_ip_15min", 2)
    monkeypatch.setattr(settings, "rate_password_per_ip_15min", 2)
    c = TestClient(app, raise_server_exceptions=False)
    codes = [c.post(f"{API}/auth/verify-otp", json={"email": f"v{i}@example.com", "code": "000000"}).status_code for i in range(3)]
    assert codes[:2] != [429, 429] and codes[2] == 429
    pw = [c.post(f"{API}/auth/login/password", json={"email": f"p{i}@example.com", "password": "wrong-password-1"}).status_code for i in range(3)]
    assert pw[2] == 429 and 429 not in pw[:2]


def test_the_per_email_limits_are_unchanged_and_still_strict(anon_client):
    c = TestClient(app, raise_server_exceptions=False)
    r = [c.post(f"{API}/auth/login/request-otp", json={"email": "same@example.com"}).status_code for _ in range(6)]
    assert r[:5] == [200] * 5 and r[5] == 429                                   # 5 codes an hour per email
    pw = [c.post(f"{API}/auth/login/password", json={"email": "pw@example.com", "password": "wrong-password-1"}).status_code for _ in range(6)]
    assert 429 not in pw[:5] and pw[5] == 429                                   # 5 password tries per email


def test_many_different_users_on_one_address_are_not_blocked_by_the_old_small_limit(anon_client):
    c = TestClient(app, raise_server_exceptions=False)
    for i in range(30):                                                          # the old limit was 10 an hour per address
        assert c.post(f"{API}/auth/login/request-otp", json={"email": f"many{i}@example.com"}).status_code == 200


def test_expired_counters_are_forgotten(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now[0])
    rate_limit.reset()
    for i in range(200):
        rate_limit.hit(f"k{i}", 5, 900)
    assert rate_limit.size() == 200
    now[0] += 901 + rate_limit.SWEEP_EVERY_SECONDS                               # every window has passed; a sweep is due
    rate_limit.hit("fresh", 5, 900)
    assert rate_limit.size() == 1


def test_live_counters_survive_a_sweep(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now[0])
    rate_limit.reset()
    for _ in range(3):
        rate_limit.hit("busy", 3, 900)
    now[0] += rate_limit.SWEEP_EVERY_SECONDS + 1                                 # still inside the 15-minute window
    rate_limit.hit("other", 3, 900)
    with pytest.raises(AppError) as e:
        rate_limit.hit("busy", 3, 900)
    assert e.value.status_code == 429
