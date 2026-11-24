"""Request guards. Every private route runs these on the server: the frontend's route guards and hidden URLs are never trusted.

* get_current_session / get_current_user - the httpOnly session cookie must match a live row in auth_sessions
* csrf_protect                           - writes need the CSRF header that matches both the CSRF cookie and the session
* limit_writes                           - a ceiling on how fast one session may change data
* require_admin                          - for future admin-only endpoints (none exist yet)
"""
from datetime import timedelta

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import rate_limit, security
from app.core.config import settings
from app.core.errors import AppError
from app.core.timezone import utc_now_naive
from app.db.scope import USER_KEY
from app.db.session import get_db
from app.models.user import AuthSession, User

SESSION_COOKIE = "gp_session"
CSRF_COOKIE = "gp_csrf"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
WRITES_PER_MINUTE = 240
_RENEW_AFTER = timedelta(minutes=5)       # don't write to the database on every single request


def get_current_session(request: Request, db: Session = Depends(get_db)) -> AuthSession:
    """The live session behind the cookie. Checked against the database on every request, so logout/revocation is immediate."""
    token = request.cookies.get(SESSION_COOKIE, "")
    row = db.scalar(select(AuthSession).where(AuthSession.token_hash == security.hash_token(token))) if token else None
    now = utc_now_naive()
    absolute_end = row.created_at + timedelta(days=settings.session_max_days) if row else None
    if row is None or row.revoked_at is not None or row.expires_at <= now or now >= absolute_end:
        raise AppError(401, "Please sign in.")
    if now - row.last_seen_at > _RENEW_AFTER:           # sliding expiry: using the app keeps you signed in
        row.last_seen_at = now
        row.expires_at = min(now + timedelta(days=settings.session_days), absolute_end)
        db.commit()
    return row


def get_current_user(session: AuthSession = Depends(get_current_session), db: Session = Depends(get_db)) -> User:
    user = db.get(User, session.user_id)
    if user is None:
        raise AppError(401, "Please sign in.")
    db.info[USER_KEY] = user.id          # from here on this request's database session can only see and create THIS user's data
    return user


def csrf_protect(request: Request, session: AuthSession = Depends(get_current_session)) -> None:
    """Double-submit token tied to the session. A page on another site can make the browser send the cookie,
    but it cannot read the CSRF cookie to copy it into the header."""
    if request.method in SAFE_METHODS:
        return
    header = request.headers.get(CSRF_HEADER, "")
    cookie = request.cookies.get(CSRF_COOKIE, "")
    if not header or not cookie or not security.same(header, cookie) or not security.same(security.hash_token(header), session.csrf_hash):
        raise AppError(403, "Security check failed. Refresh the page and try again.", code="csrf_failed")


def limit_writes(request: Request, session: AuthSession = Depends(get_current_session)) -> None:
    if request.method not in SAFE_METHODS:
        rate_limit.hit(f"write:{session.id}", WRITES_PER_MINUTE, 60)


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Use as a dependency on any future admin-only route. Normal users get 403."""
    if user.role != "admin":
        raise AppError(403, "You don't have permission to do this.", code="forbidden")
    return user
