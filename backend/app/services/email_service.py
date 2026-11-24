"""Sending the sign-in code. EMAIL_BACKEND picks how:

* "resend"  - a real email through Resend (app/services/resend_mailer.py). This is what production uses.
* "console" - development only: the code is written to the server log and no email is sent.
  (In development, if Resend's testing mode refuses an address, the code is written to the log the same way.)

A failure never leaks internals or the API key: the caller gets a short, safe message, nothing is saved (so no resend
cooldown starts) and the person can simply try again. The code itself is never logged when a real email is used.
"""
import logging

from app.core.config import settings
from app.core.errors import AppError
from app.services import resend_mailer

logger = logging.getLogger("app.email")

UNAVAILABLE = "We couldn't send the email right now. Please try again in a moment."


def send_otp(email: str, code: str, purpose: str) -> None:
    backend = settings.email_backend.lower()
    if backend == "resend":
        try:
            resend_mailer.send_otp_email(email, code, settings.otp_minutes)
        except resend_mailer.EmailConfigError as exc:
            logger.error("Email is not configured: %s", exc)            # names the missing variable, never a secret
            raise AppError(503, "Email delivery isn't set up on this server yet.", code="email_unavailable") from None
        except resend_mailer.EmailDeliveryError as exc:
            if exc.sandbox_restricted and not settings.is_production:
                # Development only: Resend's testing mode refuses everyone but the account owner. Show the code in the
                # server terminal so other test accounts can still be created. Never happens in production.
                logger.warning("DEV ONLY: Resend testing mode did not allow emailing %s. %s code is %s (valid %d min). "
                               "Verify a domain in Resend to email everyone.", resend_mailer.mask(email), purpose, code, settings.otp_minutes)
                return
            raise AppError(503, UNAVAILABLE, code="email_failed") from None     # details were already logged (masked address only)
        return
    if backend == "console" and not settings.is_production:
        logger.warning("DEV ONLY: %s code for %s is %s (valid %d min). No email was sent.", purpose, email, code, settings.otp_minutes)
        return
    raise AppError(503, "Email delivery isn't set up on this server yet.", code="email_unavailable")
