"""Pictures and videos attached to catalogue exercises.

Revision ID: b1d2c3e4f5a6
Revises: a9e1b5c7d3f0
Create Date: 2026-11-23

* ADD TABLE catalogue_media (the files themselves live in the media folder next to the database)
"""
from alembic import op
import sqlalchemy as sa

revision = "b1d2c3e4f5a6"
down_revision = "a9e1b5c7d3f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalogue_media",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("catalogue_key", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("content_type", sa.String(length=80), nullable=False),
        sa.Column("stored_name", sa.String(length=80), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('image','video')", name="ck_catalogue_media_kind"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_catalogue_media_key", "catalogue_media", ["catalogue_key"])


def downgrade() -> None:
    op.drop_index("ix_catalogue_media_key", table_name="catalogue_media")
    op.drop_table("catalogue_media")
