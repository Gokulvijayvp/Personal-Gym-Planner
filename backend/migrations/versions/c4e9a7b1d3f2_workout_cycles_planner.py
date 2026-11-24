"""Workout cycles & weekly planner: cycle status, planned cardio.

Revision ID: c4e9a7b1d3f2
Revises: b8d4f1a2c6e7
Create Date: 2026-11-18

Schema changes
* ADD   workout_cycles.status  (draft / active / completed / archived)
* DROP  workout_cycles.is_active  - replaced by status. Keeping both would give two sources of
        truth; existing values are migrated first (is_active=1 -> 'active', else 'draft').
* NEW   cardio_activities  - master data for planned cardio (seeded; cardio is NOT a muscle group)
* NEW   schedule_cardio    - planned cardio on a daily schedule (cardio-only / mixed days)

Everything else the planner needs already exists (weekly_plans, daily_schedules,
schedule_muscle_groups, schedule_exercises) and is reused unchanged.
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c4e9a7b1d3f2"
down_revision = "b8d4f1a2c6e7"
branch_labels = None
depends_on = None

CARDIO_ACTIVITIES = [
    "Walking", "Running", "Treadmill", "Cycling", "Rowing", "Elliptical",
    "Stair Climber", "Jump Rope", "Swimming", "HIIT", "Other",
]

cardio_t = sa.table(
    "cardio_activities",
    sa.column("name", sa.String), sa.column("sort_order", sa.Integer),
    sa.column("created_at", sa.DateTime), sa.column("updated_at", sa.DateTime),
)


def upgrade() -> None:
    conn = op.get_bind()
    cycle_status = sa.Enum("draft", "active", "completed", "archived", name="cyclestatus")
    if conn.dialect.name == "postgresql":
        # PostgreSQL has real enum types and add_column does not create them (SQLite stores text, so it needs nothing).
        cycle_status.create(conn, checkfirst=True)
        cycle_status = postgresql.ENUM("draft", "active", "completed", "archived", name="cyclestatus", create_type=False)

    # 1. workout_cycles: is_active -> status (data first, then drop) -------------------------
    with op.batch_alter_table("workout_cycles", schema=None) as batch_op:
        batch_op.add_column(sa.Column("status", cycle_status, nullable=False, server_default="draft"))
    expr = "CASE WHEN is_active THEN 'active' ELSE 'draft' END"
    if conn.dialect.name == "postgresql":
        expr = f"CAST({expr} AS cyclestatus)"                 # PostgreSQL will not store plain text in an enum column
    conn.execute(sa.text(f"UPDATE workout_cycles SET status = {expr}"))
    with op.batch_alter_table("workout_cycles", schema=None) as batch_op:
        batch_op.drop_column("is_active")

    # 2. cardio master data ---------------------------------------------------------------
    op.create_table(
        "cardio_activities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC, as stored
    op.bulk_insert(cardio_t, [
        {"name": n, "sort_order": i, "created_at": now, "updated_at": now}
        for i, n in enumerate(CARDIO_ACTIVITIES, start=1)
    ])

    # 3. planned cardio ---------------------------------------------------------------------
    op.create_table(
        "schedule_cardio",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("daily_schedule_id", sa.Integer(), nullable=False),
        sa.Column("cardio_activity_id", sa.Integer(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("distance_km", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["daily_schedule_id"], ["daily_schedules.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cardio_activity_id"], ["cardio_activities.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("schedule_cardio", schema=None) as batch_op:
        batch_op.create_index("ix_schedule_cardio_daily_schedule_id", ["daily_schedule_id"], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    with op.batch_alter_table("schedule_cardio", schema=None) as batch_op:
        batch_op.drop_index("ix_schedule_cardio_daily_schedule_id")
    op.drop_table("schedule_cardio")
    op.drop_table("cardio_activities")

    with op.batch_alter_table("workout_cycles", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")))
    conn.execute(sa.text("UPDATE workout_cycles SET is_active = CASE WHEN status = 'active' THEN 1 ELSE 0 END"))
    with op.batch_alter_table("workout_cycles", schema=None) as batch_op:
        batch_op.drop_column("status")
