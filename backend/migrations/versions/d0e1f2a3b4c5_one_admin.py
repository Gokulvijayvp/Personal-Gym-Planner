"""Exactly one Admin: database-level protection of the role column.

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-11-24

* checks the existing accounts FIRST (read-only) and stops before changing anything if a role is invalid or there is more
  than one Admin;
* a unique index that allows at most ONE row with role = 'admin' (a partial index: normal users are unaffected);
* only 'user' and 'admin' are allowed as roles:   PostgreSQL = a CHECK constraint
                                                    SQLite     = triggers (SQLite can only add a CHECK by rebuilding the `users`
                                                                 table, and a rebuild is dangerous here: 15 tables point at it
                                                                 with ON DELETE CASCADE);
* triggers that refuse to demote or delete the Admin row.

No row is read-modified or written. Downgrade removes all of it again.
"""
from alembic import op
import sqlalchemy as sa

revision = "d0e1f2a3b4c5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    invalid = bind.execute(sa.text("SELECT COUNT(*) FROM users WHERE role NOT IN ('user', 'admin')")).scalar()
    admins = bind.execute(sa.text("SELECT COUNT(*) FROM users WHERE role = 'admin'")).scalar()
    if invalid or admins > 1:
        raise RuntimeError(
            f"Not applied (nothing was changed): {invalid} account(s) have an invalid role and there are {admins} Admin accounts. "
            "There must be no invalid role and at most one Admin. Run `python scripts/check_roles.py` to see them.")

    op.create_index("ux_users_single_admin", "users", ["role"], unique=True,
                    sqlite_where=sa.text("role = 'admin'"), postgresql_where=sa.text("role = 'admin'"))

    if bind.dialect.name == "postgresql":
        op.create_check_constraint("ck_users_role", "users", "role IN ('user', 'admin')")
        op.execute("""
            CREATE FUNCTION protect_admin_user() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.role = 'admin' THEN
                        RAISE EXCEPTION 'The Admin account cannot be deleted';
                    END IF;
                    RETURN OLD;
                END IF;
                IF OLD.role = 'admin' AND NEW.role <> 'admin' THEN
                    RAISE EXCEPTION 'The Admin account cannot be demoted';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        """)
        op.execute("CREATE TRIGGER trg_users_protect_admin BEFORE UPDATE OF role OR DELETE ON users "
                   "FOR EACH ROW EXECUTE FUNCTION protect_admin_user()")
    else:
        op.execute("CREATE TRIGGER trg_users_role_insert BEFORE INSERT ON users WHEN NEW.role NOT IN ('user', 'admin') "
                   "BEGIN SELECT RAISE(ABORT, 'role must be user or admin'); END")
        op.execute("CREATE TRIGGER trg_users_role_update BEFORE UPDATE OF role ON users WHEN NEW.role NOT IN ('user', 'admin') "
                   "BEGIN SELECT RAISE(ABORT, 'role must be user or admin'); END")
        op.execute("CREATE TRIGGER trg_users_admin_no_demote BEFORE UPDATE OF role ON users WHEN OLD.role = 'admin' AND NEW.role <> 'admin' "
                   "BEGIN SELECT RAISE(ABORT, 'The Admin account cannot be demoted'); END")
        op.execute("CREATE TRIGGER trg_users_admin_no_delete BEFORE DELETE ON users WHEN OLD.role = 'admin' "
                   "BEGIN SELECT RAISE(ABORT, 'The Admin account cannot be deleted'); END")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_users_protect_admin ON users")
        op.execute("DROP FUNCTION IF EXISTS protect_admin_user()")
        op.drop_constraint("ck_users_role", "users", type_="check")
    else:
        for name in ("trg_users_admin_no_delete", "trg_users_admin_no_demote", "trg_users_role_update", "trg_users_role_insert"):
            op.execute(f"DROP TRIGGER IF EXISTS {name}")
    op.drop_index("ux_users_single_admin", table_name="users")
