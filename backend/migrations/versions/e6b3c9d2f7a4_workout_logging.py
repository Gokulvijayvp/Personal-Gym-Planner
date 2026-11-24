"""Workout logging: sessions, exercises, sets and cardio entries.

Revision ID: e6b3c9d2f7a4
Revises: d5a2b8c1e9f3
Create Date: 2026-11-19

The Phase 1 placeholders `workout_sessions`, `workout_set_logs` and `cardio_logs` were never used by the
application (always empty). They are replaced by a proper hierarchy:

    workout_sessions 1-* workout_session_exercises 1-* workout_session_sets
    workout_sessions 1-* workout_session_cardio

Differences that matter: a cancelled status, name snapshots, fixed-point NUMERIC weights/distances, CHECK
constraints and "one unfinished session per date" (a partial unique index).

Nothing is lost if the old tables do hold rows: upgrade converts them (grouping set logs into exercises) and
downgrade converts back into the flat legacy shape (exercise-level notes/targets and exercises without sets
cannot be represented there and are dropped). Planner tables are not touched.
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "e6b3c9d2f7a4"
down_revision = "d5a2b8c1e9f3"
branch_labels = None
depends_on = None

LOG_STATUS = "('pending','completed','skipped')"


def _rows(conn, sql):
    return [dict(r._mapping) for r in conn.execute(sa.text(sql))]


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _create_new_tables() -> None:
    op.create_table(
        "workout_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("daily_schedule_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=5), nullable=False),
        sa.Column("workout_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=11), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=True),
        sa.Column("cycle_name", sa.String(length=120), nullable=True),
        sa.Column("week_number", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("status IN ('in_progress','completed','cancelled')", name="ck_workout_sessions_status"),
        sa.CheckConstraint("source IN ('plan','blank')", name="ck_workout_sessions_source"),
        sa.CheckConstraint("(status = 'in_progress' AND ended_at IS NULL) OR (status <> 'in_progress' AND ended_at IS NOT NULL)",
                           name="ck_workout_sessions_ended"),
        sa.ForeignKeyConstraint(["daily_schedule_id"], ["daily_schedules.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workout_sessions_workout_date", "workout_sessions", ["workout_date"])
    op.create_index("ix_workout_sessions_status", "workout_sessions", ["status"])
    op.create_index("ux_workout_sessions_one_active_per_date", "workout_sessions", ["workout_date"], unique=True,
                    sqlite_where=sa.text("status = 'in_progress'"),
                    postgresql_where=sa.text("status = 'in_progress'"))

    op.create_table(
        "workout_session_exercises",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("exercise_id", sa.Integer(), nullable=True),
        sa.Column("schedule_exercise_id", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=9), nullable=False),
        sa.Column("exercise_name", sa.String(length=160), nullable=False),
        sa.Column("muscle_group_name", sa.String(length=80), nullable=True),
        sa.Column("workout_type_name", sa.String(length=80), nullable=True),
        sa.Column("target_sets", sa.Integer(), nullable=True),
        sa.Column("target_reps", sa.String(length=40), nullable=True),
        sa.Column("target_weight_kg", sa.Numeric(precision=8, scale=3), nullable=True),
        sa.Column("target_rest_seconds", sa.Integer(), nullable=True),
        sa.Column("plan_notes", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(f"status IN {LOG_STATUS}", name="ck_wse_status"),
        sa.ForeignKeyConstraint(["session_id"], ["workout_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exercise_id"], ["exercises.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["schedule_exercise_id"], ["schedule_exercises.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wse_session_id", "workout_session_exercises", ["session_id"])
    op.create_index("ix_wse_exercise_id", "workout_session_exercises", ["exercise_id"])
    op.create_index("ix_wse_exercise_name", "workout_session_exercises", ["exercise_name"])

    op.create_table(
        "workout_session_sets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_exercise_id", sa.Integer(), nullable=False),
        sa.Column("set_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=9), nullable=False),
        sa.Column("target_reps", sa.String(length=40), nullable=True),
        sa.Column("target_weight_kg", sa.Numeric(precision=8, scale=3), nullable=True),
        sa.Column("actual_reps", sa.Integer(), nullable=True),
        sa.Column("actual_weight_kg", sa.Numeric(precision=8, scale=3), nullable=True),
        sa.Column("rest_seconds", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(f"status IN {LOG_STATUS}", name="ck_wss_status"),
        sa.CheckConstraint("set_number >= 1", name="ck_wss_set_number"),
        sa.CheckConstraint("actual_reps IS NULL OR actual_reps BETWEEN 0 AND 1000", name="ck_wss_reps"),
        sa.CheckConstraint("actual_weight_kg IS NULL OR actual_weight_kg BETWEEN 0 AND 1000", name="ck_wss_weight"),
        sa.CheckConstraint("rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 7200", name="ck_wss_rest"),
        sa.ForeignKeyConstraint(["session_exercise_id"], ["workout_session_exercises.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_exercise_id", "set_number", name="uq_wss_exercise_set_number"),
    )
    op.create_index("ix_wss_session_exercise_id", "workout_session_sets", ["session_exercise_id"])

    op.create_table(
        "workout_session_cardio",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("cardio_activity_id", sa.Integer(), nullable=True),
        sa.Column("schedule_cardio_id", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=9), nullable=False),
        sa.Column("activity_name", sa.String(length=80), nullable=False),
        sa.Column("target_duration_minutes", sa.Integer(), nullable=True),
        sa.Column("target_distance_km", sa.Numeric(precision=7, scale=3), nullable=True),
        sa.Column("plan_notes", sa.Text(), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("distance_km", sa.Numeric(precision=7, scale=3), nullable=True),
        sa.Column("calories", sa.Integer(), nullable=True),
        sa.Column("speed_kmh", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("resistance", sa.String(length=40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(f"status IN {LOG_STATUS}", name="ck_wsc_status"),
        sa.CheckConstraint("duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 1440", name="ck_wsc_duration"),
        sa.CheckConstraint("distance_km IS NULL OR distance_km BETWEEN 0 AND 1000", name="ck_wsc_distance"),
        sa.CheckConstraint("calories IS NULL OR calories BETWEEN 0 AND 20000", name="ck_wsc_calories"),
        sa.CheckConstraint("speed_kmh IS NULL OR speed_kmh BETWEEN 0 AND 200", name="ck_wsc_speed"),
        sa.ForeignKeyConstraint(["session_id"], ["workout_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cardio_activity_id"], ["cardio_activities.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["schedule_cardio_id"], ["schedule_cardio.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wsc_session_id", "workout_session_cardio", ["session_id"])
    op.create_index("ix_wsc_cardio_activity_id", "workout_session_cardio", ["cardio_activity_id"])


def _create_legacy_tables() -> None:
    op.create_table(
        "workout_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("daily_schedule_id", sa.Integer(), nullable=True),
        sa.Column("workout_date", sa.Date(), nullable=False),
        sa.Column("status", sa.Enum("in_progress", "completed", "skipped", name="sessionstatus"), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("plan_snapshot", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["daily_schedule_id"], ["daily_schedules.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workout_sessions_workout_date", "workout_sessions", ["workout_date"])
    op.create_table(
        "cardio_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("activity_name", sa.String(length=100), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("distance_km", sa.Float(), nullable=True),
        sa.Column("average_speed", sa.Float(), nullable=True),
        sa.Column("calories", sa.Integer(), nullable=True),
        sa.Column("activity_date", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["workout_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "workout_set_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("exercise_id", sa.Integer(), nullable=True),
        sa.Column("exercise_name_snapshot", sa.String(length=160), nullable=False),
        sa.Column("set_number", sa.Integer(), nullable=False),
        sa.Column("target_reps", sa.String(length=40), nullable=True),
        sa.Column("actual_reps", sa.Integer(), nullable=True),
        sa.Column("target_weight_kg", sa.Float(), nullable=True),
        sa.Column("actual_weight_kg", sa.Float(), nullable=True),
        sa.Column("status", sa.Enum("pending", "completed", "skipped", name="exercisestatus"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["exercise_id"], ["exercises.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["workout_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workout_set_logs_session_id", "workout_set_logs", ["session_id"])


def _num(value, places):
    return None if value is None else round(float(value), places)


def upgrade() -> None:
    conn = op.get_bind()
    sessions = _rows(conn, "SELECT * FROM workout_sessions ORDER BY id")
    set_logs = _rows(conn, "SELECT * FROM workout_set_logs ORDER BY session_id, id")
    cardio = _rows(conn, "SELECT * FROM cardio_logs ORDER BY id")

    op.drop_table("workout_set_logs")
    op.drop_table("cardio_logs")
    op.drop_table("workout_sessions")
    _create_new_tables()

    # ---- carry over anything that was in the legacy tables (normally nothing) ----------------
    now = _utcnow()
    active_dates: set = set()
    for s in sessions:
        status = {"skipped": "cancelled"}.get(str(s["status"]), str(s["status"]))
        started = s["started_at"] or s["completed_at"] or s["created_at"]
        reason = None
        if status == "in_progress":
            if s["workout_date"] in active_dates:        # the new unique index allows one unfinished session per date
                status, reason = "cancelled", "Converted from a duplicate unfinished session."
            else:
                active_dates.add(s["workout_date"])
        ended = None if status == "in_progress" else (s["completed_at"] or started)
        conn.execute(sa.text(
            "INSERT INTO workout_sessions (id, daily_schedule_id, source, workout_date, status, started_at, ended_at, "
            "notes, cancel_reason, created_at, updated_at) VALUES (:id, :sched, :source, :d, :status, :started, :ended, "
            ":notes, :reason, :c, :u)"),
            dict(id=s["id"], sched=s["daily_schedule_id"], source="plan" if s["daily_schedule_id"] else "blank", d=s["workout_date"],
                 status=status, started=started, ended=ended, notes=s["notes"], reason=reason, c=s["created_at"], u=s["updated_at"]))

    grouped: dict = {}
    for log in set_logs:
        grouped.setdefault((log["session_id"], log["exercise_id"], log["exercise_name_snapshot"]), []).append(log)
    positions: dict = {}
    for (session_id, exercise_id, name), logs in grouped.items():
        positions[session_id] = positions.get(session_id, 0) + 1
        statuses = {str(x["status"]) for x in logs}
        ex_status = statuses.pop() if len(statuses) == 1 else "pending"
        result = conn.execute(sa.text(
            "INSERT INTO workout_session_exercises (session_id, exercise_id, position, status, exercise_name, created_at, updated_at) "
            "VALUES (:s, :e, :p, :st, :n, :c, :u)"),
            dict(s=session_id, e=exercise_id, p=positions[session_id], st=ex_status, n=name, c=logs[0]["created_at"], u=logs[0]["updated_at"]))
        ex_id = result.lastrowid
        for number, log in enumerate(sorted(logs, key=lambda x: (x["set_number"], x["id"])), start=1):
            conn.execute(sa.text(
                "INSERT INTO workout_session_sets (session_exercise_id, set_number, status, target_reps, target_weight_kg, "
                "actual_reps, actual_weight_kg, notes, created_at, updated_at) VALUES (:e, :n, :st, :tr, :tw, :ar, :aw, :notes, :c, :u)"),
                dict(e=ex_id, n=number, st=str(log["status"]), tr=log["target_reps"], tw=_num(log["target_weight_kg"], 3),
                     ar=log["actual_reps"], aw=_num(log["actual_weight_kg"], 3), notes=log["notes"], c=log["created_at"], u=log["updated_at"]))

    cardio_positions: dict = {}
    for c in cardio:
        session_id = c["session_id"]
        if session_id is None:                            # stand-alone cardio: give it a completed session of its own
            moment = f"{str(c['activity_date'])[:10]} 00:00:00"      # raw SQL hands dates back as text
            session_id = conn.execute(sa.text(
                "INSERT INTO workout_sessions (source, workout_date, status, started_at, ended_at, created_at, updated_at) "
                "VALUES ('blank', :d, 'completed', :t, :t, :c, :u)"),
                dict(d=c["activity_date"], t=moment, c=c["created_at"], u=c["updated_at"])).lastrowid
        cardio_positions[session_id] = cardio_positions.get(session_id, 0) + 1
        conn.execute(sa.text(
            "INSERT INTO workout_session_cardio (session_id, position, status, activity_name, duration_minutes, distance_km, "
            "calories, speed_kmh, notes, created_at, updated_at) VALUES (:s, :p, 'completed', :n, :dur, :dist, :cal, :sp, :notes, :c, :u)"),
            dict(s=session_id, p=cardio_positions[session_id], n=c["activity_name"][:80], dur=c["duration_minutes"],
                 dist=_num(c["distance_km"], 3), cal=c["calories"], sp=_num(c["average_speed"], 2), notes=c["notes"],
                 c=c["created_at"], u=c["updated_at"]))


def downgrade() -> None:
    conn = op.get_bind()
    sessions = _rows(conn, "SELECT * FROM workout_sessions ORDER BY id")
    exercises = _rows(conn, "SELECT * FROM workout_session_exercises ORDER BY session_id, position, id")
    sets = _rows(conn, "SELECT * FROM workout_session_sets ORDER BY session_exercise_id, set_number")
    cardio = _rows(conn, "SELECT * FROM workout_session_cardio ORDER BY session_id, position, id")

    op.drop_table("workout_session_cardio")
    op.drop_table("workout_session_sets")
    op.drop_table("workout_session_exercises")
    op.drop_table("workout_sessions")
    _create_legacy_tables()

    by_id = {s["id"]: s for s in sessions}
    for s in sessions:
        status = {"cancelled": "skipped"}.get(s["status"], s["status"])
        notes = s["notes"]
        if s["cancel_reason"]:
            notes = f"Cancelled: {s['cancel_reason']}" + (f"\n{notes}" if notes else "")
        conn.execute(sa.text(
            "INSERT INTO workout_sessions (id, daily_schedule_id, workout_date, status, started_at, completed_at, notes, created_at, updated_at) "
            "VALUES (:id, :sched, :d, :st, :started, :ended, :notes, :c, :u)"),
            dict(id=s["id"], sched=s["daily_schedule_id"], d=s["workout_date"], st=status, started=s["started_at"],
                 ended=s["ended_at"], notes=notes, c=s["created_at"], u=s["updated_at"]))
    ex_by_id = {e["id"]: e for e in exercises}
    for st in sets:
        e = ex_by_id[st["session_exercise_id"]]
        conn.execute(sa.text(
            "INSERT INTO workout_set_logs (session_id, exercise_id, exercise_name_snapshot, set_number, target_reps, actual_reps, "
            "target_weight_kg, actual_weight_kg, status, notes, created_at, updated_at) "
            "VALUES (:s, :e, :n, :num, :tr, :ar, :tw, :aw, :st, :notes, :c, :u)"),
            dict(s=e["session_id"], e=e["exercise_id"], n=e["exercise_name"], num=st["set_number"], tr=st["target_reps"],
                 ar=st["actual_reps"], tw=_num(st["target_weight_kg"], 3), aw=_num(st["actual_weight_kg"], 3), st=st["status"],
                 notes=st["notes"], c=st["created_at"], u=st["updated_at"]))
    for c in cardio:
        conn.execute(sa.text(
            "INSERT INTO cardio_logs (session_id, activity_name, duration_minutes, distance_km, average_speed, calories, "
            "activity_date, notes, created_at, updated_at) VALUES (:s, :n, :dur, :dist, :sp, :cal, :d, :notes, :c, :u)"),
            dict(s=c["session_id"], n=c["activity_name"], dur=c["duration_minutes"] or c["target_duration_minutes"] or 0,
                 dist=_num(c["distance_km"], 3), sp=_num(c["speed_kmh"], 2), cal=c["calories"],
                 d=by_id[c["session_id"]]["workout_date"], notes=c["notes"], c=c["created_at"], u=c["updated_at"]))
