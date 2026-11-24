"""Exercise masters: a master list of exercise names with an icon motion; library exercises link to it.

Revision ID: f7c4d0e3a8b5
Revises: e6b3c9d2f7a4
Create Date: 2026-11-19

* ADD TABLE  exercise_masters (name unique ignoring case, icon_motion, is_active)
* ADD COLUMN exercises.exercise_master_id (FK, ON DELETE SET NULL); the batch rebuild drops the expression
  index ux_exercises_name_lower, so it is re-created
* BACKFILL   one master per existing exercise (icon motion guessed from its name / muscle group) and link it

Downgrade removes the link column and the table. The exercise rows themselves are kept untouched; the batch
rebuild needed to drop the column re-creates ux_exercises_name_lower explicitly.
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

from app.core.exercise_motion import DOWNGRADE_MAP, ORIGINAL_MOTIONS, guess_motion

revision = "f7c4d0e3a8b5"
down_revision = "e6b3c9d2f7a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    motions = ",".join(f"'{m}'" for m in ORIGINAL_MOTIONS)   # this revision allows the original 12 only
    op.create_table(
        "exercise_masters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("icon_motion", sa.String(length=12), server_default="generic", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(f"icon_motion IN ({motions})", name="ck_exercise_masters_motion"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ux_exercise_masters_name_lower", "exercise_masters", [sa.text("lower(name)")], unique=True)
    # A table-level *named* FK (via a batch rebuild) so that SQLAlchemy reflects ON DELETE SET NULL and
    # `alembic check` stays clean. The rebuild drops the expression index, so it is re-created right after.
    sqlite = op.get_bind().dialect.name == "sqlite"
    with op.batch_alter_table("exercises", recreate="always" if sqlite else "auto") as batch:      # PostgreSQL alters in place: no rebuild
        batch.add_column(sa.Column("exercise_master_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_exercises_exercise_master_id", "exercise_masters", ["exercise_master_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_exercises_exercise_master_id", "exercises", ["exercise_master_id"])
    if sqlite:                                                                                      # only the SQLite rebuild drops this index
        op.create_index("ux_exercises_name_lower", "exercises", [sa.text("lower(name)")], unique=True)

    conn = op.get_bind()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = conn.execute(sa.text(
        "SELECT e.id, e.name, g.name AS grp FROM exercises e LEFT JOIN muscle_groups g ON g.id = e.muscle_group_id ORDER BY e.id"
    )).fetchall()
    by_key: dict[str, int] = {}
    for ex_id, name, grp in rows:
        key = name.strip().lower()
        if key not in by_key:
            new_id = conn.execute(
                sa.text("INSERT INTO exercise_masters (name, icon_motion, is_active, created_at, updated_at) "
                        "VALUES (:n, :m, TRUE, :t, :t) RETURNING id"),
                {"n": name.strip(), "m": DOWNGRADE_MAP.get(guess_motion(name, grp), guess_motion(name, grp)), "t": now},
            ).scalar_one()
            by_key[key] = new_id
        conn.execute(sa.text("UPDATE exercises SET exercise_master_id = :m WHERE id = :i"), {"m": by_key[key], "i": ex_id})


def downgrade() -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"
    op.drop_index("ix_exercises_exercise_master_id", table_name="exercises")
    with op.batch_alter_table("exercises", recreate="always" if sqlite else "auto") as batch:
        batch.drop_constraint("fk_exercises_exercise_master_id", type_="foreignkey")
        batch.drop_column("exercise_master_id")
    if sqlite:
        op.create_index("ux_exercises_name_lower", "exercises", [sa.text("lower(name)")], unique=True)
    op.drop_index("ux_exercise_masters_name_lower", table_name="exercise_masters")
    op.drop_table("exercise_masters")
