"""Safe, verified backup of the SQLite database using SQLite's own backup API (consistent even while the app runs).

Usage (from the backend folder):
    python scripts/backup_db.py                       # backs up data/gym_planner.db into data/backups/
    python scripts/backup_db.py path/to/other.db
    python scripts/backup_db.py path/to/db BACKUP_DIR [KEEP]     # custom folder; KEEP = how many newest backups to keep (older ones are deleted)

The copy is checked with PRAGMA integrity_check and by comparing the row count of every table with the source.
Exit code 0 only when the backup is verified.
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def tables(con: sqlite3.Connection) -> list[str]:
    return [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def backup(source: Path, dest_dir: Path) -> Path:
    if not source.exists():
        raise SystemExit(f"Database not found: {source}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{source.stem}_{datetime.now():%Y%m%d_%H%M%S}.db"
    src = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
    dst = sqlite3.connect(dest)
    try:
        src.backup(dst)                                    # the SQLite online backup API
        dst.commit()
        problems = dst.execute("PRAGMA integrity_check").fetchall()
        if problems != [("ok",)]:
            raise SystemExit(f"Backup failed the integrity check: {problems}")
        for name in tables(src):
            a = src.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            b = dst.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            if a != b:
                raise SystemExit(f"Backup row count differs in {name}: {a} vs {b}")
    except BaseException:
        dst.close(); src.close()
        dest.unlink(missing_ok=True)                       # never leave a half-trusted backup behind
        raise
    dst.close(); src.close()
    return dest


def prune(dest_dir: Path, stem: str, keep: int) -> int:
    """Delete all but the newest `keep` backups of this database. Only files named <stem>_YYYYMMDD_HHMMSS.db are touched."""
    old = sorted(dest_dir.glob(f"{stem}_[0-9]*_[0-9]*.db"))[:-keep] if keep > 0 else []
    for f in old:
        f.unlink(missing_ok=True)
    return len(old)


if __name__ == "__main__":
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else BACKEND / "data" / "gym_planner.db"
    folder = Path(sys.argv[2]) if len(sys.argv) > 2 else BACKEND / "data" / "backups"
    out = backup(source, folder)                       # a failed backup exits non-zero BEFORE anything is pruned
    print(f"Backup verified: {out}")
    if len(sys.argv) > 3:
        removed = prune(folder, source.stem, int(sys.argv[3]))
        if removed:
            print(f"Removed {removed} older backup(s).")
