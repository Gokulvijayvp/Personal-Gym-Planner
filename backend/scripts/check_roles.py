"""READ-ONLY check of the account roles in a database. It never changes anything.

    python scripts/check_roles.py                              # the local SQLite database (data/gym_planner.db)
    python scripts/check_roles.py path/to/other.db
    python scripts/check_roles.py "postgresql+psycopg://user:pw@host/db"

Reports every account (email masked), how many are Admin, whether any role is invalid, and whether the Admin matches ADMIN_EMAIL
(from the environment or backend/.env). Exit code 0 = healthy: no invalid role and at most one Admin.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.session import normalise_url  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


def mask(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else str(BACKEND / "data" / "gym_planner.db")
    if "://" in target:
        engine = create_engine(normalise_url(target))
    else:
        engine = create_engine(f"sqlite:///file:{Path(target).resolve().as_posix()}?mode=ro&uri=true")     # opened read-only
    with engine.connect() as c:
        rows = c.execute(text("SELECT id, email, role FROM users ORDER BY id")).fetchall()
    admins = [r for r in rows if r.role == "admin"]
    invalid = [r for r in rows if r.role not in ("user", "admin")]
    print(f"accounts: {len(rows)} | admins: {len(admins)} | normal users: {sum(r.role == 'user' for r in rows)} | invalid roles: {len(invalid)}")
    for r in rows:
        print(f"  id={r.id}  {mask(r.email):28} role={r.role}")
    pinned = (settings.admin_email or "").strip().lower() if hasattr(settings, "admin_email") else ""
    if pinned:
        match = admins and admins[0].email.lower() == pinned
        print(f"ADMIN_EMAIL is set ({mask(pinned)}): the Admin {'matches it' if match else 'DOES NOT match it' if admins else 'has not registered yet'}")
    else:
        print("ADMIN_EMAIL is not set in this environment.")
    healthy = not invalid and len(admins) <= 1
    print("RESULT:", "healthy" if healthy else "PROBLEM (invalid role or more than one Admin)")
    return 0 if healthy else 1


if __name__ == "__main__":
    raise SystemExit(main())
