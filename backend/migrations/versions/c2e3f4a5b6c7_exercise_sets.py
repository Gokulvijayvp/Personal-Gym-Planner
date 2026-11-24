"""My exercises: named groups of catalogue exercises ("Chest A").

Revision ID: c2e3f4a5b6c7
Revises: b1d2c3e4f5a6
Create Date: 2026-11-23

* ADD TABLE exercise_sets, exercise_set_items (items are deleted with their set)
"""
from alembic import op
import sqlalchemy as sa

revision = "c2e3f4a5b6c7"
down_revision = "b1d2c3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exercise_sets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("muscle_group", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "exercise_set_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("catalogue_key", sa.String(length=120), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["set_id"], ["exercise_sets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exercise_set_items_set", "exercise_set_items", ["set_id"])


def downgrade() -> None:
    op.drop_index("ix_exercise_set_items_set", table_name="exercise_set_items")
    op.drop_table("exercise_set_items")
    op.drop_table("exercise_sets")
