from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timezone import utc_now_naive
from app.db.base import Base


class ExerciseSetShare(Base):
    """A frozen copy of one person's whole "My exercises" list, reachable by a unique code.

    Deliberately NOT a per-user table: someone else must be able to look the code up. It holds only set names, muscle
    groups and catalogue keys (no personal data), and it expires. Later edits to the original list do not change it."""
    __tablename__ = "exercise_set_shares"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    snapshot: Mapped[list] = mapped_column(JSON, nullable=False)       # [{"name", "muscle_group", "exercise_keys": [...]}, ...]
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
