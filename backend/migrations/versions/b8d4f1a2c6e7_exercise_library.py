"""Exercise library: target areas, secondary muscles, description, unique names.

Revision ID: b8d4f1a2c6e7
Revises: a3c5e7f91b24
Create Date: 2026-11-18

Schema changes
* NEW  target_areas                         - master data, muscle group -> its target areas (seeded)
* NEW  exercise_secondary_muscle_groups     - many-to-many link (exercise <-> extra muscle groups)
* ADD  exercises.description (TEXT, nullable)
* ADD  exercises.target_area_id (FK -> target_areas, SET NULL) replacing free-text exercises.target_area
* ADD  unique index ux_exercises_name_lower  (case-insensitive exercise names)

Data safety
* Existing free-text target_area values are mapped to target_area_id by name; the free-text
  column is dropped only after that. Values that cannot be mapped, or case-insensitive duplicate
  names, abort the migration BEFORE any change is made (SQLite cannot roll back DDL).
* Seeding is idempotent and never modifies existing rows.
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "b8d4f1a2c6e7"
down_revision = "a3c5e7f91b24"
branch_labels = None
depends_on = None

# Muscle group name -> target areas (in display order).
TARGET_AREAS: dict[str, list[str]] = {
    "Chest": ["Upper Chest", "Middle Chest", "Lower Chest", "Inner Chest"],
    "Back": ["Upper Back", "Middle Back", "Lower Back", "Lats"],
    "Shoulders": ["Front Delts", "Side Delts", "Rear Delts"],
    "Biceps": ["Biceps"],
    "Triceps": ["Triceps"],
    "Forearms": ["Forearms"],
    "Abs / Core": ["Upper Abs", "Lower Abs", "Obliques"],
    "Quadriceps": ["Quadriceps"],
    "Hamstrings": ["Hamstrings"],
    "Glutes": ["Glutes"],
    "Calves": ["Calves"],
}

target_areas_t = sa.table(
    "target_areas",
    sa.column("muscle_group_id", sa.Integer), sa.column("name", sa.String),
    sa.column("sort_order", sa.Integer),
    sa.column("created_at", sa.DateTime), sa.column("updated_at", sa.DateTime),
)


def _preflight(conn) -> None:
    """Fail early, before touching the schema."""
    seen: dict[str, str] = {}
    for (name,) in conn.execute(sa.text("SELECT name FROM exercises")):
        key = name.lower()
        if key in seen:
            raise RuntimeError(
                f"Cannot add case-insensitive unique exercise names: '{seen[key]}' and '{name}' "
                "are duplicates. Rename one of them and run the migration again.")
        seen[key] = name

    rows = conn.execute(sa.text(
        "SELECT e.id, e.target_area, g.name FROM exercises e "
        "JOIN muscle_groups g ON g.id = e.muscle_group_id WHERE e.target_area IS NOT NULL AND TRIM(e.target_area) <> ''"
    )).fetchall()
    for ex_id, text_value, group in rows:
        valid = {a.lower() for a in TARGET_AREAS.get(group, [])}
        if text_value.strip().lower() not in valid:
            raise RuntimeError(
                f"Exercise {ex_id} has target_area '{text_value}' which is not a known target area for "
                f"'{group}'. Fix or clear it, then run the migration again.")


def upgrade() -> None:
    conn = op.get_bind()
    _preflight(conn)

    # 1. Master table + seed ---------------------------------------------------------------
    op.create_table(
        "target_areas",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("muscle_group_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["muscle_group_id"], ["muscle_groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("muscle_group_id", "name", name="uq_target_area_group_name"),
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC, as stored
    groups = {name: gid for gid, name in conn.execute(sa.text("SELECT id, name FROM muscle_groups"))}
    rows = [
        {"muscle_group_id": groups[g], "name": a, "sort_order": i, "created_at": now, "updated_at": now}
        for g, areas in TARGET_AREAS.items() if g in groups
        for i, a in enumerate(areas, start=1)
    ]
    if rows:
        op.bulk_insert(target_areas_t, rows)

    # 2. Secondary muscle groups link table -------------------------------------------------
    op.create_table(
        "exercise_secondary_muscle_groups",
        sa.Column("exercise_id", sa.Integer(), nullable=False),
        sa.Column("muscle_group_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["exercise_id"], ["exercises.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["muscle_group_id"], ["muscle_groups.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("exercise_id", "muscle_group_id"),
    )

    # 3. exercises: new columns, move free-text target area -> FK, drop old column ----------
    with op.batch_alter_table("exercises", schema=None) as batch_op:
        batch_op.add_column(sa.Column("description", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("target_area_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_exercises_target_area_id", "target_areas",
                                    ["target_area_id"], ["id"], ondelete="SET NULL")
        batch_op.create_index("ix_exercises_target_area_id", ["target_area_id"], unique=False)

    conn.execute(sa.text(
        "UPDATE exercises SET target_area_id = ("
        "  SELECT ta.id FROM target_areas ta WHERE ta.muscle_group_id = exercises.muscle_group_id "
        "  AND lower(ta.name) = lower(TRIM(exercises.target_area))) "
        "WHERE target_area IS NOT NULL AND TRIM(target_area) <> ''"
    ))

    with op.batch_alter_table("exercises", schema=None) as batch_op:
        batch_op.drop_column("target_area")

    # 4. Expression index LAST: SQLite batch-recreate cannot reflect (and would drop) it ----
    op.create_index("ux_exercises_name_lower", "exercises", [sa.text("lower(name)")], unique=True)


def downgrade() -> None:
    conn = op.get_bind()
    op.drop_index("ux_exercises_name_lower", table_name="exercises")

    with op.batch_alter_table("exercises", schema=None) as batch_op:
        batch_op.add_column(sa.Column("target_area", sa.String(length=120), nullable=True))

    conn.execute(sa.text(
        "UPDATE exercises SET target_area = "
        "(SELECT name FROM target_areas WHERE target_areas.id = exercises.target_area_id) "
        "WHERE target_area_id IS NOT NULL"
    ))

    with op.batch_alter_table("exercises", schema=None) as batch_op:
        batch_op.drop_index("ix_exercises_target_area_id")
        batch_op.drop_constraint("fk_exercises_target_area_id", type_="foreignkey")
        batch_op.drop_column("target_area_id")
        batch_op.drop_column("description")

    op.drop_table("exercise_secondary_muscle_groups")
    op.drop_table("target_areas")
