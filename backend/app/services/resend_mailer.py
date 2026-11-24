"""Sending email through Resend. Server-side only: the API key is read from the environment, is never returned by any
endpoint, and is never written to logs. OTP values are never logged either; log lines name only a masked recipient."""
import logging
import re

import resend

from app.core.config import settings
from app.services.email_templates import render_otp_email

logger = logging.getLogger("app.email")


class EmailConfigError(RuntimeError):
    """Email delivery is not configured (a required environment variable is missing or malformed)."""


class EmailDeliveryError(RuntimeError):
    """Resend refused or could not send the message. The text is safe to show (it never holds the API key)."""

    def __init__(self, message: str, sandbox_restricted: bool = False) -> None:
        super().__init__(message)
        self.sandbox_restricted = sandbox_restricted      # True: Resend's testing mode only allows the account owner's address


def check_config() -> tuple[str, str]:
    """Return (api_key, from_address) or raise a clear error naming exactly what is missing. Nothing secret is echoed."""
    missing = [name for name, value in (("RESEND_API_KEY", settings.resend_api_key), ("RESEND_FROM_EMAIL", settings.resend_from_email))
               if not (value or "").strip()]
    if missing:
        raise EmailConfigError(f"Email delivery is not configured. Set {' and '.join(missing)} in backend/.env.")
    key, sender = settings.resend_api_key.strip(), settings.resend_from_email.strip()
    if not key.startswith("re_"):
        raise EmailConfigError("RESEND_API_KEY doesn't look like a Resend key (it should start with 're_').")
    if not re.search(r"[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+", sender):
        raise EmailConfigError("RESEND_FROM_EMAIL must be an address like 'Gym Planner <name@your-domain>'.")
    return key, sender


def mask(address: str) -> str:
    """'someone@example.com' -> 's***@example.com' for logs."""
    local, _, domain = address.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def _scrub(text: str, key: str) -> str:
    return text.replace(key, "[redacted]") if key else text


def send_email(to: str, subject: str, html: str, text: str) -> str:
    """Send one message to one recipient. Returns Resend's message id."""
    key, sender = check_config()
    if not re.fullmatch(r"[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+", to or ""):
        raise EmailDeliveryError("The recipient must be exactly one valid email address.")
    try:
        resend.api_key = key
        result = resend.Emails.send({"from": sender, "to": [to], "subject": subject, "html": html, "text": text})
    except Exception as exc:                                  # the SDK raises several error types; none may leak the key
        reason = _scrub(str(exc), key)[:200]
        logger.error("Email to %s failed (%s).", mask(to), type(exc).__name__)
        raise EmailDeliveryError(f"Resend could not send the email: {reason}",
                                 sandbox_restricted="only send testing emails" in str(exc).lower()) from None
    message_id = (result.get("id") if isinstance(result, dict) else getattr(result, "id", None)) or "unknown"
    logger.info("Email sent to %s (id %s).", mask(to), message_id)
    return message_id


def send_otp_email(to: str, code: str, expires_minutes: int = 5) -> str:
    """The sign-in code email. (Not connected to login/signup yet: that waits for review of the delivery test.)"""
    subject, html, text = render_otp_email(code, expires_minutes)
    return send_email(to, subject, html, text)


def send_test_email(to: str, expires_minutes: int = 5) -> str:
    """A clearly labelled test email using the real template, with a dummy code that does nothing."""
    subject, html, text = render_otp_email("123456", expires_minutes, test=True)
    return send_email(to, subject, html, text)
