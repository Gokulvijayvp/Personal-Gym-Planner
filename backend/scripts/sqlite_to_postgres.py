"""Copy ALL data from a SQLite database into an empty PostgreSQL database (for example AWS RDS).

    1. On the target, create the tables first:   DATABASE_URL=<postgres url>  python -m alembic upgrade head
    2. Then copy:                                python scripts/sqlite_to_postgres.py --sqlite data/gym_planner.db --postgres "<postgres url>"

Safety:
* the SQLite file is opened read-only and is never changed;
* both databases must be at the same schema version, or nothing is copied;
* it refuses to run if the target already has user accounts, unless you add --replace (which first EMPTIES the target);
* everything is copied in one transaction (all or nothing) and the row count of every table is checked afterwards.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, func, select, text  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.session import normalise_url  # noqa: E402
from app import models  # noqa: E402,F401  (registers every table)

BATCH = 500


def version(engine) -> str | None:
    with engine.connect() as c:
        return c.execute(text("SELECT version_num FROM alembic_version")).scalar()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sqlite", required=True, help="path of the SQLite database to copy from")
    ap.add_argument("--postgres", required=True, help="URL of the empty PostgreSQL database to copy into")
    ap.add_argument("--replace", action="store_true", help="empty the target first if it already has data")
    args = ap.parse_args()

    src_path = Path(args.sqlite)
    if not src_path.is_file():
        print(f"SQLite file not found: {src_path}")
        return 1
    src = create_engine(f"sqlite:///file:{src_path.resolve().as_posix()}?mode=ro&uri=true")
    dst = create_engine(normalise_url(args.postgres), pool_pre_ping=True)
    if dst.dialect.name != "postgresql":
        print("--postgres must be a PostgreSQL URL.")
        return 1

    v_src, v_dst = version(src), version(dst)
    if v_src != v_dst:
        print(f"Schema versions differ (SQLite {v_src}, PostgreSQL {v_dst}). Run `python -m alembic upgrade head` on BOTH, then try again.")
        return 1

    tables = list(Base.metadata.sorted_tables)               # parents before children
    with dst.connect() as c:
        users = c.execute(select(func.count()).select_from(Base.metadata.tables["users"])).scalar()
    if users and not args.replace:
        print(f"The target already has {users} user account(s). Nothing was copied. Use --replace to empty it first.")
        return 1

    copied: dict[str, int] = {}
    with src.connect() as s, dst.begin() as d:                # one transaction on the target: all or nothing
        names = ", ".join(f'"{t.name}"' for t in tables)
        d.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))      # the migrations' seed rows are replaced by yours (same ids)
        for t in tables:
            n = 0
            rows = s.execute(select(t).execution_options(stream_results=True)).mappings()
            batch = []
            for row in rows:
                batch.append(dict(row))
                if len(batch) >= BATCH:
                    d.execute(t.insert(), batch); n += len(batch); batch = []
            if batch:
                d.execute(t.insert(), batch); n += len(batch)
            copied[t.name] = n
        # ids were copied explicitly, so move each id counter past the highest one (otherwise the next insert would collide)
        for t in tables:
            if "id" in t.c and t.c.id.autoincrement is not False and t.c.id.primary_key:
                d.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('\"{t.name}\"', 'id'), COALESCE((SELECT MAX(id) FROM \"{t.name}\"), 1), "
                    f"(SELECT MAX(id) IS NOT NULL FROM \"{t.name}\")) WHERE pg_get_serial_sequence('\"{t.name}\"', 'id') IS NOT NULL"))

    bad = []
    with src.connect() as s, dst.connect() as d:
        for t in tables:
            a = s.execute(select(func.count()).select_from(t)).scalar()
            b = d.execute(select(func.count()).select_from(t)).scalar()
            if a != b:
                bad.append((t.name, a, b))
    if bad:
        print("Row counts differ after the copy:", bad)
        return 2
    total = sum(copied.values())
    print(f"Copied {total} rows in {len(tables)} tables. Every table's row count matches.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
