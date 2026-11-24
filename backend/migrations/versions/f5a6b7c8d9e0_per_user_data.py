"""Per-user data: every private table gets an owner (user_id).

Revision ID: f5a6b7c8d9e0
Revises: e4a5b6c7d8e9
Create Date: 2026-11-23

* ADD COLUMN user_id (nullable, FK users.id, indexed) to every table that holds a person's own data.
  Existing rows keep every value; their user_id stays NULL (hidden from everyone) until the FIRST account is created,
  which claims them. Nothing is deleted or moved.
* Exercise names and "one active workout per day" become unique PER USER instead of across the whole database.
* app_settings: drops the "only row id = 1" rule so each user can have their own settings row.
"""
from alembic import op
import sqlalchemy as sa

revision = "f5a6b7c8d9e0"
down_revision = "e4a5b6c7d8e9"
branch_labels = None
depends_on = None

OWNED = [   # (app_settings is handled separately below)
    "workout_cycles", "weekly_plans", "daily_schedules", "schedule_muscle_groups", "schedule_exercises", "schedule_cardio",
    "exercises", "body_metrics", "workout_sessions", "workout_session_exercises", "workout_session_sets",
    "workout_session_cardio", "exercise_sets", "exercise_set_items", "catalogue_media",
]


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:         # first: this rebuilds the table, so add the column after it
        batch.drop_constraint("ck_app_settings_single_row", type_="check")

    for table in OWNED + ["app_settings"]:
        # SQLite can add a nullable column that references another table in place (no table rebuild, no data touched).
        op.execute(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE CASCADE")
        op.create_index(f"ix_{table}_user_id", table, ["user_id"])

    op.drop_index("ux_exercises_name_lower", table_name="exercises")
    op.create_index("ux_exercises_user_name_lower", "exercises", ["user_id", sa.text("lower(name)")], unique=True)
    op.drop_index("ux_workout_sessions_one_active_per_date", table_name="workout_sessions")
    op.create_index("ux_workout_sessions_user_one_active_per_date", "workout_sessions", ["user_id", "workout_date"], unique=True,
                    sqlite_where=sa.text("status = 'in_progress'"),
                    postgresql_where=sa.text("status = 'in_progress'"))


def downgrade() -> None:
    # Drop the per-user indexes and columns first (rebuilding a table discards indexes made earlier), THEN restore the old indexes.
    op.drop_index("ux_workout_sessions_user_one_active_per_date", table_name="workout_sessions")
    op.drop_index("ux_exercises_user_name_lower", table_name="exercises")

    for table in reversed(OWNED + ["app_settings"]):
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_column("user_id")

    with op.batch_alter_table("app_settings") as batch:
        batch.create_check_constraint("ck_app_settings_single_row", "id = 1")

    op.create_index("ux_exercises_name_lower", "exercises", [sa.text("lower(name)")], unique=True)
    op.create_index("ux_workout_sessions_one_active_per_date", "workout_sessions", ["workout_date"], unique=True,
                    sqlite_where=sa.text("status = 'in_progress'"),
                    postgresql_where=sa.text("status = 'in_progress'"))
