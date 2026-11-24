"""Email-code and password sign-in for a multi-user app with exactly one Admin: request a code, verify it, get a server-side session, sign out."""
import hmac
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.errors import AppError
from app.core.timezone import utc_now_naive
from app.db.scope import owned_models
from app.models.user import AuthSession, OtpCode, User
from app.services import email_service


@dataclass
class Login:
    user: User
    session_token: str
    csrf_token: str


def _user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def _claim_unowned_data(db: Session, user_id: int) -> None:
    """Data that existed before accounts did (and so belongs to nobody) goes to the very first account. Nothing is deleted."""
    for model in owned_models():
        db.execute(update(model).where(model.user_id.is_(None)).values(user_id=user_id)
                   .execution_options(synchronize_session=False, unscoped=True))    # system step: it must see the ownerless rows


def role_for(email: str) -> str:
    """The role a NEW account gets. Only the pinned ADMIN_EMAIL is ever the Admin; everybody else, always, is a normal user.
    (This is the only place a role is decided: no request can supply one.)"""
    admin = settings.admin_email_normalised
    return "admin" if admin is not None and email == admin else "user"


def request_otp(db: Session, purpose: str, email: str, full_name: str | None = None, phone: str | None = None,
                password: str | None = None, password_hash: str | None = None) -> int:
    """Create and send a code. Returns the seconds before another may be requested.

    Login for an email that has no account answers exactly like success and sends nothing, so nobody can use this
    form to find out whose email is registered. Anyone may sign up and becomes a normal user who only ever sees their own data;
    the one Admin is the account whose email is ADMIN_EMAIL."""
    now = utc_now_naive()
    user = _user_by_email(db, email)
    if purpose == "signup" and user is not None:
        raise AppError(409, "This email already has an account. Log in instead.", code="account_exists")
    if purpose == "login" and user is None:
        return settings.otp_resend_seconds

    latest = db.scalar(select(OtpCode).where(OtpCode.email == email).order_by(OtpCode.id.desc()).limit(1))
    if latest is not None:
        wait = settings.otp_resend_seconds - int((now - latest.created_at).total_seconds())
        if wait > 0:
            raise AppError(429, f"Please wait {wait} seconds before asking for a new code.", code="otp_cooldown",
                           headers={"Retry-After": str(wait)})

    code = security.new_otp()
    db.execute(update(OtpCode).where(OtpCode.email == email).values(consumed_at=func.coalesce(OtpCode.consumed_at, now), password_hash=None))   # older codes stop working
    db.query(OtpCode).filter(OtpCode.created_at < now - timedelta(days=1)).delete()                                   # housekeeping
    db.add(OtpCode(email=email, purpose=purpose, code_hash=security.hash_otp(email, code), full_name=full_name, phone=phone,
                   password_hash=password_hash or (security.hash_password(password) if password else None), expires_at=now + timedelta(minutes=settings.otp_minutes)))
    email_service.send_otp(email, code, purpose)       # if sending fails nothing is committed, so no cooldown is started
    db.commit()
    return settings.otp_resend_seconds


def resend_signup_otp(db: Session, email: str) -> int:
    """A new code for a sign-up in progress. The password stays on the server (as a hash) from the first step, so the
    browser never has to keep it. Without a pending sign-up the person has to start again."""
    pending = db.scalar(select(OtpCode).where(OtpCode.email == email, OtpCode.purpose == "signup", OtpCode.password_hash.is_not(None),
                                              OtpCode.consumed_at.is_(None)).order_by(OtpCode.id.desc()).limit(1))
    if pending is None:
        raise AppError(400, "Your sign-up has expired. Please start again.", code="signup_expired")
    return request_otp(db, "signup", email, pending.full_name, pending.phone, password_hash=pending.password_hash)


def login_with_password(db: Session, email: str, password: str, user_agent: str | None = None) -> Login:
    """Same answer for 'no such account', 'no password set' and 'wrong password', so nothing leaks about which emails exist."""
    user = _user_by_email(db, email)
    ok = security.verify_password(password, user.password_hash if user else None)
    if not user or not ok:
        raise AppError(401, "Incorrect email or password.", code="invalid_credentials")
    user.last_login_at = utc_now_naive()
    db.flush()
    return _start_session(db, user, user_agent)


def _start_session(db: Session, user: User, user_agent: str | None) -> Login:
    now = utc_now_naive()
    token, csrf = security.new_token(), security.new_token()
    db.add(AuthSession(user_id=user.id, token_hash=security.hash_token(token), csrf_hash=security.hash_token(csrf),
                       expires_at=now + timedelta(days=settings.session_days), user_agent=(user_agent or "")[:200] or None))
    db.query(AuthSession).filter(AuthSession.expires_at < now - timedelta(days=7)).delete()       # housekeeping
    db.commit()
    return Login(user=user, session_token=token, csrf_token=csrf)


def verify_otp(db: Session, email: str, code: str, user_agent: str | None = None) -> Login:
    now = utc_now_naive()
    otp = db.scalar(select(OtpCode).where(OtpCode.email == email, OtpCode.consumed_at.is_(None)).order_by(OtpCode.id.desc()).limit(1))
    if otp is None or otp.expires_at <= now:
        raise AppError(400, "This code has expired. Ask for a new one.", code="otp_expired")
    if otp.attempts >= settings.otp_max_attempts:
        raise AppError(429, "Too many wrong tries. Ask for a new code.", code="otp_locked")
    if not hmac.compare_digest(otp.code_hash, security.hash_otp(email, code)):
        otp.attempts += 1
        db.commit()
        raise AppError(400, "That code isn't right. Check it and try again.", code="otp_invalid")

    # Use the code up in ONE statement ("mark used only if it is still unused"). Of two requests racing with the same code,
    # exactly one wins; the other is told the code is no longer valid.
    pending_hash = otp.password_hash
    won = db.execute(update(OtpCode).where(OtpCode.id == otp.id, OtpCode.consumed_at.is_(None))
                     .values(consumed_at=now, password_hash=None).execution_options(synchronize_session=False)).rowcount
    if won != 1:
        db.rollback()
        raise AppError(400, "This code has expired. Ask for a new one.", code="otp_expired")
    user = _user_by_email(db, email)
    if user is None:
        if otp.purpose != "signup":
            db.commit()
            raise AppError(400, "This code has expired. Ask for a new one.", code="otp_expired")
        role = role_for(email)
        user = User(email=email, full_name=otp.full_name, phone=otp.phone, role=role, password_hash=pending_hash)
        db.add(user)
        try:
            db.flush()
        except IntegrityError:        # the same email was registered a moment ago (unique email), or a second Admin was refused by the database
            db.rollback()
            raise AppError(409, "This email already has an account. Log in instead.", code="account_exists") from None
        if role == "admin":
            _claim_unowned_data(db, user.id)        # data that existed before accounts belongs to the Admin account
    user.last_login_at = now
    db.flush()
    return _start_session(db, user, user_agent)


def reissue_csrf(db: Session, session: AuthSession) -> str:
    """A fresh CSRF token for an existing session (for a browser that lost its CSRF cookie)."""
    csrf = security.new_token()
    session.csrf_hash = security.hash_token(csrf)
    db.commit()
    return csrf


def logout(db: Session, session_token: str | None) -> None:
    if not session_token:
        return
    db.execute(update(AuthSession).where(AuthSession.token_hash == security.hash_token(session_token), AuthSession.revoked_at.is_(None))
               .values(revoked_at=utc_now_naive()))
    db.commit()
