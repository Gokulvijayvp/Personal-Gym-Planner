"""READ-ONLY fingerprint of a database: the row count and a checksum of every table's content.

    python scripts/table_fingerprint.py data/gym_planner.db  > before.json
    ... do something ...
    python scripts/table_fingerprint.py data/gym_planner.db  > after.json
    python scripts/table_fingerprint.py --compare before.json after.json [--ignore users_role_guards]

Proves that nothing in your data changed. The checksum covers every column of every row (ordered by primary key), so any
changed, added or removed value shows up. The SQLite file is opened read-only.
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, inspect, text  # noqa: E402

from app.db.session import normalise_url  # noqa: E402


def fingerprint(target: str) -> dict:
    if "://" in target:
        engine = create_engine(normalise_url(target))
    else:
        engine = create_engine(f"sqlite:///file:{Path(target).resolve().as_posix()}?mode=ro&uri=true")
    out = {}
    with engine.connect() as c:
        for table in sorted(inspect(engine).get_table_names()):
            cols = [col["name"] for col in inspect(engine).get_columns(table)]
            pk = inspect(engine).get_pk_constraint(table)["constrained_columns"] or cols
            order = ", ".join(f'"{k}"' for k in pk)
            h = hashlib.sha256()
            n = 0
            for row in c.execute(text(f'SELECT {", ".join(chr(34) + k + chr(34) for k in cols)} FROM "{table}" ORDER BY {order}')):
                h.update(repr(tuple(str(v) for v in row)).encode())
                n += 1
            out[table] = {"rows": n, "sha256": h.hexdigest()}
    return out


def main() -> int:
    if sys.argv[1] == "--compare":
        a, b = json.load(open(sys.argv[2])), json.load(open(sys.argv[3]))
        diffs = [(t, a.get(t), b.get(t)) for t in sorted(set(a) | set(b)) if a.get(t) != b.get(t)]
        print(f"tables compared: {len(set(a) | set(b))} | tables whose rows or content differ: {len(diffs)}")
        for t, x, y in diffs:
            print("  DIFFERENT:", t, x, "->", y)
        return 1 if diffs else 0
    print(json.dumps(fingerprint(sys.argv[1]), indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
