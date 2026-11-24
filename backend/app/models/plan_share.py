from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timezone import utc_now_naive
from app.db.base import Base


class PlanShare(Base):
    """A frozen copy of one day or one week of a workout plan, reachable by a unique code.

    Not a per-user table, because someone else must be able to look the code up. It holds names only (muscle groups,
    exercise names, sets/reps, cardio), never ids or personal data, so it can be rebuilt in anyone's own library. It expires."""
    __tablename__ = "plan_shares"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    kind: Mapped[str] = mapped_column(String(4), nullable=False)               # "day" | "week"
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
