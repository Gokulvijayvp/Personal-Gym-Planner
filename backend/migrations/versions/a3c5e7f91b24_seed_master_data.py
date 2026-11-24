"""Seed muscle groups and workout types.

Revision ID: a3c5e7f91b24
Revises: d719fa6c863c
Create Date: 2026-11-18

Data-only migration (no schema change). It is idempotent: rows whose name
already exists are left untouched, so existing user data is never modified.
Cardio is intentionally NOT a muscle group.
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "a3c5e7f91b24"
down_revision = "d719fa6c863c"
branch_labels = None
depends_on = None

MUSCLE_GROUPS = [
    "Chest", "Back", "Shoulders", "Biceps", "Triceps", "Forearms",
    "Abs / Core", "Quadriceps", "Hamstrings", "Glutes", "Calves",
]
WORKOUT_TYPES = [
    "Barbell", "Dumbbell", "Machine", "Cable", "Bodyweight",
    "Smith Machine", "Resistance Band", "Other",
]

muscle_groups = sa.table(
    "muscle_groups",
    sa.column("name", sa.String), sa.column("sort_order", sa.Integer),
    sa.column("created_at", sa.DateTime), sa.column("updated_at", sa.DateTime),
)
workout_types = sa.table(
    "workout_types",
    sa.column("name", sa.String),
    sa.column("created_at", sa.DateTime), sa.column("updated_at", sa.DateTime),
)


def _existing(conn, table) -> set[str]:
    return {row[0] for row in conn.execute(sa.select(table.c.name))}


def upgrade():
    conn = op.get_bind()
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC, as stored

    have = _existing(conn, muscle_groups)
    rows = [
        {"name": n, "sort_order": i, "created_at": now, "updated_at": now}
        for i, n in enumerate(MUSCLE_GROUPS, start=1) if n not in have
    ]
    if rows:
        op.bulk_insert(muscle_groups, rows)

    have = _existing(conn, workout_types)
    rows = [
        {"name": n, "created_at": now, "updated_at": now}
        for n in WORKOUT_TYPES if n not in have
    ]
    if rows:
        op.bulk_insert(workout_types, rows)


def downgrade():
    # Remove only seeded rows that nothing references (FKs are RESTRICT/SET NULL).
    conn = op.get_bind()
    conn.execute(sa.text(
        "DELETE FROM muscle_groups WHERE name IN :names AND id NOT IN "
        "(SELECT muscle_group_id FROM exercises) AND id NOT IN "
        "(SELECT muscle_group_id FROM schedule_muscle_groups)"
    ).bindparams(sa.bindparam("names", MUSCLE_GROUPS, expanding=True)))
    conn.execute(sa.text(
        "DELETE FROM workout_types WHERE name IN :names AND id NOT IN "
        "(SELECT workout_type_id FROM exercises WHERE workout_type_id IS NOT NULL)"
    ).bindparams(sa.bindparam("names", WORKOUT_TYPES, expanding=True)))
