from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column


class OwnedMixin:
    """Marks a table as holding one user's private data.

    The column is filled in automatically from the signed-in user when a row is created, and every query on
    these tables is filtered to that user (see app/db/scope.py). Nullable only so that data created before
    accounts existed can wait, unowned and invisible, until the first account claims it.
    """
    # The database column is created with ON DELETE CASCADE (see the migration). The model says so too, so PostgreSQL and the
    # migrations agree. SQLite cannot report that option back for a column added in place; migrations/env.py skips that one comparison.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
