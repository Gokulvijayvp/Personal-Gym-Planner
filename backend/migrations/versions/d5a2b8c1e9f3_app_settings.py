"""Application settings (single row).

Revision ID: d5a2b8c1e9f3
Revises: c4e9a7b1d3f2
Create Date: 2026-11-19

* NEW app_settings - exactly one row (CHECK id = 1), inserted here with the defaults.
Nothing else is touched; downgrade drops only this table.
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "d5a2b8c1e9f3"
down_revision = "c4e9a7b1d3f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("display_name", sa.String(length=50), nullable=True),
        sa.Column("rest_between_sets_seconds", sa.Integer(), server_default="90", nullable=False),
        sa.Column("rest_between_exercises_seconds", sa.Integer(), server_default="120", nullable=False),
        sa.Column("target_workout_minutes", sa.Integer(), server_default="60", nullable=False),
        sa.Column("weight_unit", sa.String(length=3), server_default="kg", nullable=False),
        sa.Column("distance_unit", sa.String(length=5), server_default="km", nullable=False),
        sa.Column("week_start", sa.String(length=6), server_default="monday", nullable=False),
        sa.Column("date_format", sa.String(length=12), server_default="DD MMM YYYY", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_app_settings_single_row"),
        sa.CheckConstraint("rest_between_sets_seconds BETWEEN 0 AND 3600", name="ck_app_settings_rest_sets"),
        sa.CheckConstraint("rest_between_exercises_seconds BETWEEN 0 AND 3600", name="ck_app_settings_rest_exercises"),
        sa.CheckConstraint("target_workout_minutes BETWEEN 1 AND 600", name="ck_app_settings_target_minutes"),
        sa.CheckConstraint("weight_unit IN ('kg','lbs')", name="ck_app_settings_weight_unit"),
        sa.CheckConstraint("distance_unit IN ('km','miles')", name="ck_app_settings_distance_unit"),
        sa.CheckConstraint("week_start IN ('monday','sunday')", name="ck_app_settings_week_start"),
        sa.CheckConstraint("date_format IN ('DD/MM/YYYY','DD MMM YYYY','YYYY-MM-DD')", name="ck_app_settings_date_format"),
        sa.PrimaryKeyConstraint("id"),
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    op.bulk_insert(
        sa.table("app_settings", sa.column("id", sa.Integer), sa.column("created_at", sa.DateTime), sa.column("updated_at", sa.DateTime)),
        [{"id": 1, "created_at": now, "updated_at": now}],  # every other column takes its server default
    )


def downgrade() -> None:
    op.drop_table("app_settings")
