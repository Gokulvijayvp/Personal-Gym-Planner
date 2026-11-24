"""Email delivery tests. Resend is replaced by a fake: nothing here sends a real email or needs the real key."""
import logging

import pytest
import resend

from app.core.config import settings
from app.services import resend_mailer as mailer
from app.services.email_templates import render_otp_email

KEY = "re_test_0123456789abcdefghijklmnop"
SENDER = "Gym Planner <no-reply@example.com>"
TO = "owner@example.com"


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", KEY)
    monkeypatch.setattr(settings, "resend_from_email", SENDER)


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(resend.Emails, "send", staticmethod(lambda params: (sent.append(params), {"id": "msg_123"})[1]))
    return sent


def test_missing_settings_give_a_clear_error_naming_only_the_variables(monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", None)
    monkeypatch.setattr(settings, "resend_from_email", "  ")
    with pytest.raises(mailer.EmailConfigError) as e:
        mailer.check_config()
    assert "RESEND_API_KEY" in str(e.value) and "RESEND_FROM_EMAIL" in str(e.value)
    monkeypatch.setattr(settings, "resend_api_key", KEY)
    with pytest.raises(mailer.EmailConfigError, match="RESEND_FROM_EMAIL") as e:
        mailer.check_config()
    assert KEY not in str(e.value)


def test_malformed_settings_are_rejected(monkeypatch):
    monkeypatch.setattr(settings, "resend_from_email", SENDER)
    monkeypatch.setattr(settings, "resend_api_key", "not-a-resend-key")
    with pytest.raises(mailer.EmailConfigError, match="re_"):
        mailer.check_config()
    monkeypatch.setattr(settings, "resend_api_key", KEY)
    monkeypatch.setattr(settings, "resend_from_email", "no address here")
    with pytest.raises(mailer.EmailConfigError, match="RESEND_FROM_EMAIL"):
        mailer.check_config()


def test_the_template_has_the_code_the_expiry_and_the_brand_colours():
    subject, html, text = render_otp_email("482913", 5)
    assert "482 913" in subject and "482 913" in html and "482 913" in text
    assert "5 minutes" in html and "5 minutes" in text
    for colour in ("#202329", "#292E36", "#FF8A24", "#F5F6F8", "#A7ADB7"):
        assert colour.lower() in html.lower()
    assert "Gym Planner" in html and "<table" in html


def test_the_test_email_is_clearly_labelled_and_the_template_escapes_input():
    _, html, text = render_otp_email("123456", 5, test=True)
    assert "Test message" in html and "TEST MESSAGE" in text
    _, html2, _ = render_otp_email("<script>1", 5)
    assert "<script>" not in html2


def test_send_test_email_goes_to_exactly_one_recipient_with_the_configured_sender(configured, outbox):
    assert mailer.send_test_email(TO) == "msg_123"
    (msg,) = outbox
    assert msg["to"] == [TO] and msg["from"] == SENDER
    assert "test" in msg["subject"].lower() and "5 minutes" in msg["html"]


@pytest.mark.parametrize("bad", ["", "a@b", "a@b.co, c@d.co", "a@b.co;c@d.co", "x y@b.co", "<a@b.co>"])
def test_only_a_single_valid_recipient_is_accepted(configured, outbox, bad):
    with pytest.raises(mailer.EmailDeliveryError):
        mailer.send_email(bad, "s", "<p>h</p>", "t")
    assert outbox == []


def test_otp_email_uses_the_real_code(configured, outbox):
    mailer.send_otp_email(TO, "654321", 5)
    assert "654 321" in outbox[0]["html"] and "654 321" in outbox[0]["subject"]


def test_provider_errors_become_a_safe_message_without_the_key(configured, monkeypatch):
    def boom(params):
        raise resend.exceptions.ResendError(code=403, error_type="validation_error", message=f"bad key {KEY}", suggested_action="x")
    monkeypatch.setattr(resend.Emails, "send", staticmethod(boom))
    with pytest.raises(mailer.EmailDeliveryError) as e:
        mailer.send_email(TO, "s", "<p>h</p>", "t")
    assert KEY not in str(e.value) and "[redacted]" in str(e.value)


def test_logs_never_contain_the_api_key_otp_or_full_address(configured, outbox, caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    mailer.send_otp_email(TO, "865421", 5)
    def boom(params):
        raise RuntimeError(f"network down {KEY}")
    monkeypatch.setattr(resend.Emails, "send", staticmethod(boom))
    with pytest.raises(mailer.EmailDeliveryError):
        mailer.send_otp_email(TO, "865421", 5)
    logs = caplog.text
    assert KEY not in logs and "865421" not in logs and "865 421" not in logs and TO not in logs
    assert "o***@example.com" in logs


def test_the_key_is_never_returned_by_the_api_or_the_config_endpoints(anon_client, configured):
    for path in ("/openapi.json", "/api/v1/health", "/", "/health"):
        assert KEY not in anon_client.get(path).text
    assert not any(w in p.lower() for p in anon_client.get("/openapi.json").json()["paths"] for w in ("send-email", "test-email", "mail"))   # no endpoint can trigger an email


# ----------------------------------------------------------------------------- connected to sign-up and login

API = "/api/v1"


@pytest.fixture
def resend_on(configured, outbox, monkeypatch):
    monkeypatch.setattr(settings, "email_backend", "resend")
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)
    return outbox


def code_in(message) -> str:
    """The 6 digits shown in the email (written as '123 456')."""
    import re
    m = re.search(r"(\d{3}) (\d{3})", message["text"])
    return m.group(1) + m.group(2)


def test_signup_emails_the_code_through_resend_and_that_code_signs_you_in(anon_client, resend_on, caplog, monkeypatch):
    monkeypatch.setattr(settings, "admin_email", "new@example.com")          # the pinned Admin signs up
    caplog.set_level(logging.DEBUG)
    r = anon_client.post(f"{API}/auth/signup/request-otp", json={"email": "new@example.com", "password": "a-strong-test-password"})
    assert r.status_code == 200
    (msg,) = resend_on
    assert msg["to"] == ["new@example.com"] and msg["from"] == SENDER and "5 minutes" in msg["html"]
    code = code_in(msg)
    assert code not in r.text and code not in caplog.text                  # not in the API response, not in the logs
    assert anon_client.post(f"{API}/auth/verify-otp", json={"email": "new@example.com", "code": code}).status_code == 200
    assert anon_client.get(f"{API}/auth/me").json()["role"] == "admin"


def test_login_emails_a_code_only_to_real_accounts(anon_client, resend_on):
    anon_client.post(f"{API}/auth/signup/request-otp", json={"email": "me@example.com", "password": "a-strong-test-password"})
    anon_client.post(f"{API}/auth/verify-otp", json={"email": "me@example.com", "code": code_in(resend_on[-1])})
    anon_client.post(f"{API}/auth/logout"); anon_client.cookies.clear()
    resend_on.clear()
    assert anon_client.post(f"{API}/auth/login/request-otp", json={"email": "stranger@example.com"}).status_code == 200
    assert resend_on == []                                                   # nothing is emailed to unregistered addresses
    assert anon_client.post(f"{API}/auth/login/request-otp", json={"email": "me@example.com"}).status_code == 200
    assert [m["to"] for m in resend_on] == [["me@example.com"]]
    assert anon_client.post(f"{API}/auth/verify-otp", json={"email": "me@example.com", "code": code_in(resend_on[-1])}).status_code == 200


def test_resending_a_signup_code_emails_a_fresh_one(anon_client, resend_on):
    anon_client.post(f"{API}/auth/signup/request-otp", json={"email": "new@example.com", "password": "a-strong-test-password"})
    assert anon_client.post(f"{API}/auth/signup/resend-otp", json={"email": "new@example.com"}).status_code == 200
    assert len(resend_on) == 2 and all(m["to"] == ["new@example.com"] for m in resend_on)


def test_a_failed_send_gives_a_safe_503_and_does_not_start_the_cooldown(anon_client, configured, monkeypatch, caplog):
    monkeypatch.setattr(settings, "email_backend", "resend")
    monkeypatch.setattr(settings, "otp_resend_seconds", 60)
    caplog.set_level(logging.DEBUG)

    def boom(params):
        raise RuntimeError(f"upstream said no {KEY}")
    monkeypatch.setattr(resend.Emails, "send", staticmethod(boom))
    r = anon_client.post(f"{API}/auth/signup/request-otp", json={"email": "new@example.com", "password": "a-strong-test-password"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "email_failed"
    assert KEY not in r.text and KEY not in caplog.text and "upstream" not in r.text
    sent = []
    monkeypatch.setattr(resend.Emails, "send", staticmethod(lambda params: (sent.append(params), {"id": "x"})[1]))
    assert anon_client.post(f"{API}/auth/signup/request-otp", json={"email": "new@example.com", "password": "a-strong-test-password"}).status_code == 200
    assert len(sent) == 1                                                    # the person could retry straight away


def test_missing_email_settings_give_a_clear_503_not_a_crash(anon_client, monkeypatch):
    monkeypatch.setattr(settings, "email_backend", "resend")
    monkeypatch.setattr(settings, "resend_api_key", None)
    r = anon_client.post(f"{API}/auth/signup/request-otp", json={"email": "new@example.com", "password": "a-strong-test-password"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "email_unavailable" and "RESEND" not in r.text


def test_the_code_lifetime_is_five_minutes_everywhere():
    assert settings.otp_minutes == 5


def test_production_requires_real_email(monkeypatch):
    from app.core.config import settings as s
    monkeypatch.setattr(s, "app_env", "production")
    monkeypatch.setattr(s, "secret_key", "x" * 48)
    monkeypatch.setattr(s, "cookie_secure", True)
    monkeypatch.setattr(s, "app_debug", False)
    monkeypatch.setattr(s, "email_backend", "console")
    with pytest.raises(RuntimeError, match="EMAIL_BACKEND"):
        s.check_production()
    monkeypatch.setattr(s, "email_backend", "resend")
    monkeypatch.setattr(s, "resend_api_key", None)
    with pytest.raises(RuntimeError, match="RESEND_API_KEY"):
        s.check_production()
    monkeypatch.setattr(s, "resend_api_key", KEY)
    monkeypatch.setattr(s, "resend_from_email", SENDER)
    s.check_production()                                                     # fully configured: allowed


SANDBOX_MSG = "You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain"


def test_in_development_resend_testing_mode_falls_back_to_the_terminal_code(anon_client, configured, monkeypatch, caplog):
    monkeypatch.setattr(settings, "email_backend", "resend")
    monkeypatch.setattr(settings, "otp_resend_seconds", 0)
    caplog.set_level(logging.DEBUG)

    def refuse(params):
        raise RuntimeError(SANDBOX_MSG)
    monkeypatch.setattr(resend.Emails, "send", staticmethod(refuse))
    r = anon_client.post(f"{API}/auth/signup/request-otp", json={"email": "other@example.com", "password": "a-strong-test-password"})
    assert r.status_code == 200                                                    # the sign-up goes on
    import re
    code = re.search(r"code is (\d{6})", caplog.text).group(1)                     # ...and the code is in the server log
    assert "o***@example.com" in caplog.text and "other@example.com" not in caplog.text and KEY not in caplog.text
    assert code not in r.text
    assert anon_client.post(f"{API}/auth/verify-otp", json={"email": "other@example.com", "code": code}).status_code == 200


def test_in_production_resend_testing_mode_is_still_an_error_and_never_logs_the_code(anon_client, configured, monkeypatch, caplog):
    monkeypatch.setattr(settings, "email_backend", "resend")
    monkeypatch.setattr(settings, "app_env", "production")
    caplog.set_level(logging.DEBUG)

    def refuse(params):
        raise RuntimeError(SANDBOX_MSG)
    monkeypatch.setattr(resend.Emails, "send", staticmethod(refuse))
    r = anon_client.post(f"{API}/auth/signup/request-otp", json={"email": "other@example.com", "password": "a-strong-test-password"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "email_failed"
    assert "code is" not in caplog.text
