"""More icon motions for exercise masters (flat/incline/decline press, fly, push-up, dip, leg extension, ...).

Revision ID: a9e1b5c7d3f0
Revises: f7c4d0e3a8b5
Create Date: 2026-11-19

Only the CHECK constraint on exercise_masters.icon_motion changes (12 -> 28 allowed values); no row is
modified on upgrade. The batch rebuild drops the expression index, so it is re-created. Downgrade first maps
any newer motion to the closest original one, so no master is lost.
"""
from alembic import op
import sqlalchemy as sa

from app.core.exercise_motion import DOWNGRADE_MAP, MOTIONS, ORIGINAL_MOTIONS

revision = "a9e1b5c7d3f0"
down_revision = "f7c4d0e3a8b5"
branch_labels = None
depends_on = None


def _in_list(keys) -> str:
    return "icon_motion IN (" + ",".join(f"'{k}'" for k in keys) + ")"


def _swap_check(keys) -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"
    with op.batch_alter_table("exercise_masters", recreate="always" if sqlite else "auto") as batch:    # PostgreSQL alters in place
        batch.drop_constraint("ck_exercise_masters_motion", type_="check")
        batch.create_check_constraint("ck_exercise_masters_motion", _in_list(keys))
    if sqlite:                                                                                          # only the SQLite rebuild drops the index
        op.create_index("ux_exercise_masters_name_lower", "exercise_masters", [sa.text("lower(name)")], unique=True)


def upgrade() -> None:
    _swap_check(MOTIONS)


def downgrade() -> None:
    conn = op.get_bind()
    for newer, older in DOWNGRADE_MAP.items():
        conn.execute(sa.text("UPDATE exercise_masters SET icon_motion = :o WHERE icon_motion = :n"), {"o": older, "n": newer})
    _swap_check(ORIGINAL_MOTIONS)
