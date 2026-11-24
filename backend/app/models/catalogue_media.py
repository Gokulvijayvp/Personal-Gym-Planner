from sqlalchemy import CheckConstraint, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.workout import TimestampMixin


class CatalogueMedia(TimestampMixin, Base):
    """A picture or video the admin attached to a catalogue exercise (by its catalogue key). Shared: every user sees it."""
    __tablename__ = "catalogue_media"
    __table_args__ = (
        CheckConstraint("kind IN ('image','video')", name="ck_catalogue_media_kind"),
        Index("ix_catalogue_media_key", "catalogue_key"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    catalogue_key: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    content_type: Mapped[str] = mapped_column(String(80), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(80), nullable=False)      # file name inside the media folder
    original_name: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
