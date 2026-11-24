from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timezone import utc_now_naive
from app.db.base import Base
from app.models.workout import TimestampMixin


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        # At most ONE row may have role = 'admin' (a partial unique index: ordinary users are not affected).
        Index("ux_users_single_admin", "role", unique=True, sqlite_where=text("role = 'admin'"), postgresql_where=text("role = 'admin'")),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)     # stored lower-case
    full_name: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(32))                            # future feature, never required
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)
    password_hash: Mapped[str | None] = mapped_column(String(255))                   # scrypt hash, never the password; empty = code sign-in only
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="user", server_default="user")   # "user" | "admin": exactly one Admin, pinned to ADMIN_EMAIL


class OtpCode(Base):
    """A one-time sign-in code. Only a keyed hash of the code is stored, never the code itself."""
    __tablename__ = "otp_codes"
    __table_args__ = (Index("ix_otp_codes_email", "email"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    purpose: Mapped[str] = mapped_column(String(10), nullable=False)                 # "login" | "signup"
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(120))                       # signup details wait here until the code is verified
    phone: Mapped[str | None] = mapped_column(String(32))
    password_hash: Mapped[str | None] = mapped_column(String(255))                   # the chosen password, hashed, waiting for the email to be verified
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime)


class AuthSession(Base):
    """One signed-in browser. The cookie holds a random token; only its hash is stored here, so a leaked
    database cannot be used to sign in, and deleting/revoking the row signs that browser out at once."""
    __tablename__ = "auth_sessions"
    __table_args__ = (Index("ix_auth_sessions_user", "user_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    user_agent: Mapped[str | None] = mapped_column(String(200))
