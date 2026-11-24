"""Admin-added catalogue exercises, and shared (not per-user) catalogue pictures.

Revision ID: a7b8c9d0e1f2
Revises: f5a6b7c8d9e0
Create Date: 2026-11-23

* ADD TABLE catalogue_exercises (shared; created by the admin)
* catalogue_media becomes shared: the admin uploads, everyone sees. Its user_id column is dropped; no picture is deleted.
"""
from alembic import op
import sqlalchemy as sa

revision = "a7b8c9d0e1f2"
down_revision = "f5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalogue_exercises",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("muscle_group", sa.String(length=80), nullable=False),
        sa.Column("target_area", sa.String(length=80), nullable=True),
        sa.Column("equipment", sa.String(length=80), nullable=False),
        sa.Column("movement", sa.String(length=200), nullable=True),
        sa.Column("icon_motion", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ux_catalogue_exercises_name_lower", "catalogue_exercises", [sa.text("lower(name)")], unique=True)
    op.drop_index("ix_catalogue_media_user_id", table_name="catalogue_media")
    with op.batch_alter_table("catalogue_media") as batch:
        batch.drop_column("user_id")


def downgrade() -> None:
    op.execute("ALTER TABLE catalogue_media ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE CASCADE")
    op.create_index("ix_catalogue_media_user_id", "catalogue_media", ["user_id"])
    op.drop_index("ux_catalogue_exercises_name_lower", table_name="catalogue_exercises")
    op.drop_table("catalogue_exercises")
