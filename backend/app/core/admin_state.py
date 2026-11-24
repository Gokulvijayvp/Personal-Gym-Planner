"""Start-up check that the accounts in the database agree with ADMIN_EMAIL (exactly one Admin, and it is that email).

In production a disagreement STOPS the server with a clear message. In development it is logged. A database that is not ready
yet (for example before the migrations ran) is only a warning here: the migrations and the guards in the database are separate.
"""
import logging

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User

logger = logging.getLogger("app.startup")


def inspect_admin_state(db: Session) -> tuple[list[str], list[str]]:
    """Returns (problems, warnings). Reads only."""
    problems: list[str] = []
    warnings: list[str] = []
    rows = db.execute(select(User.id, User.email, User.role)).all()
    invalid = [r for r in rows if r.role not in ("user", "admin")]
    admins = [r for r in rows if r.role == "admin"]
    if invalid:
        problems.append(f"{len(invalid)} account(s) have a role that is not 'user' or 'admin'")
    if len(admins) > 1:
        problems.append(f"there are {len(admins)} Admin accounts, but there must be exactly one")

    pinned = settings.admin_email_normalised
    if pinned is None:
        warnings.append("ADMIN_EMAIL is not set, so nobody can become the Admin (existing accounts are not changed). "
                        "Set ADMIN_EMAIL in backend/.env to the Admin's email address.")
        return problems, warnings
    bad = settings.admin_email_problem()
    if bad:
        problems.append(bad)
        return problems, warnings
    by_email = {r.email.lower(): r for r in rows}
    if admins and admins[0].email.lower() != pinned:
        problems.append("the Admin account in the database is not the ADMIN_EMAIL account")
    if pinned in by_email and by_email[pinned].role != "admin":
        problems.append("the account for ADMIN_EMAIL exists but is not the Admin")
    if pinned not in by_email:
        warnings.append("the Admin (ADMIN_EMAIL) has not registered yet")
    return problems, warnings


def run_startup_check(session_factory) -> None:
    try:
        with session_factory() as db:
            problems, warnings = inspect_admin_state(db)
    except SQLAlchemyError as exc:
        logger.warning("Could not check the Admin account (is the database ready?): %s", type(exc).__name__)
        return
    for w in warnings:
        logger.warning("Admin account: %s", w)
    if problems:
        message = "Admin account check failed: " + "; ".join(problems) + "."
        if settings.is_production:
            raise RuntimeError(message + " Fix this, then start the server again.")
        logger.error(message)
