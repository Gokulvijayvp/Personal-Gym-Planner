"""My exercises: named sets of catalogue exercises for one muscle group."""
import secrets
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.services.exercise_catalogue_service import entries_by_key
from app.core.timezone import utc_now_naive
from app.models.exercise_set import ExerciseSet, ExerciseSetItem
from app.models.exercise_set_share import ExerciseSetShare
from app.schemas.common import ErrorDetail
from app.schemas.exercise_set import (
    ExerciseSetExercise, ExerciseSetInput, ExerciseSetRead, ImportResult, ShareCreated, SharedPreview, SharedSetSummary,
)


def _read(s: ExerciseSet, by_key: dict) -> ExerciseSetRead:
    exercises = [
        ExerciseSetExercise(key=e.key, name=e.name, equipment=e.equipment, icon_motion=e.icon_motion)
        for it in s.items if (e := by_key.get(it.catalogue_key)) is not None     # an entry dropped from the catalogue is skipped
    ]
    return ExerciseSetRead(id=s.id, name=s.name, muscle_group=s.muscle_group, exercises=exercises, created_at=s.created_at)


def list_sets(db: Session) -> list[ExerciseSetRead]:
    rows = db.scalars(select(ExerciseSet).order_by(ExerciseSet.muscle_group, ExerciseSet.name, ExerciseSet.id)).all()
    by_key = entries_by_key(db)
    return [_read(s, by_key) for s in rows]


def _validate(db: Session, data: ExerciseSetInput, own_id: int | None) -> list[str]:
    keys = list(dict.fromkeys(data.exercise_keys))                              # drop repeats, keep order
    by_key = entries_by_key(db)
    for k in keys:
        entry = by_key.get(k)
        if entry is None:
            raise AppError(404, "One of the chosen exercises is not in the catalogue.", code="catalogue_item_not_found")
        if entry.muscle_group != data.muscle_group:
            raise AppError(422, f"'{entry.name}' is not a {data.muscle_group} exercise.", code="wrong_muscle_group")
    clash = select(ExerciseSet.id).where(func.lower(ExerciseSet.name) == data.name.lower())
    if own_id is not None:
        clash = clash.where(ExerciseSet.id != own_id)
    if db.scalar(clash) is not None:
        raise AppError(409, f"You already have a set called '{data.name}'.", code="duplicate_name",
                       details=[ErrorDetail(field="name", message="Already used.", type="value_error")])
    return keys


def create_set(db: Session, data: ExerciseSetInput) -> ExerciseSetRead:
    keys = _validate(db, data, None)
    s = ExerciseSet(name=data.name, muscle_group=data.muscle_group,
                    items=[ExerciseSetItem(catalogue_key=k, position=i) for i, k in enumerate(keys)])
    db.add(s)
    db.commit()
    return _read(s, entries_by_key(db))


def update_set(db: Session, set_id: int, data: ExerciseSetInput) -> ExerciseSetRead:
    s = db.get(ExerciseSet, set_id)
    if s is None:
        raise AppError(404, "That set no longer exists.", code="exercise_set_not_found")
    keys = _validate(db, data, set_id)
    s.name, s.muscle_group = data.name, data.muscle_group
    s.items = [ExerciseSetItem(catalogue_key=k, position=i) for i, k in enumerate(keys)]
    db.commit()
    return _read(s, entries_by_key(db))


def delete_set(db: Session, set_id: int) -> None:
    s = db.get(ExerciseSet, set_id)
    if s is None:
        raise AppError(404, "That set no longer exists.", code="exercise_set_not_found")
    db.delete(s)
    db.commit()


# ---- sharing "My exercises" with a code --------------------------------------------------------------

SHARE_DAYS = 30
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"            # no 0/O/1/I: easy to read out or type
CODE_LENGTH = 10                                         # 32^10 = 50 bits: unguessable, and lookups are rate limited as well
NOT_VALID = "That code isn't valid or has expired. Check it and try again."


def _pretty(code: str) -> str:
    return f"{code[:5]}-{code[5:]}"


def _normalise(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def create_share(db: Session) -> ShareCreated:
    """Freeze the caller's whole list under a new unique code."""
    sets = db.scalars(select(ExerciseSet).order_by(ExerciseSet.muscle_group, ExerciseSet.name, ExerciseSet.id)).all()
    snapshot = [{"name": s.name, "muscle_group": s.muscle_group, "exercise_keys": [i.catalogue_key for i in s.items]}
                for s in sets if s.items]
    if not snapshot:
        raise AppError(400, "You have no sets to share yet. Create one first.", code="nothing_to_share")
    now = utc_now_naive()
    for _ in range(5):                                    # a clash is astronomically unlikely, but retry rather than fail
        code = "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LENGTH))
        if db.scalar(select(ExerciseSetShare.id).where(ExerciseSetShare.code == code)) is None:
            break
    share = ExerciseSetShare(code=code, owner_id=db.info.get("user_id"), snapshot=snapshot, expires_at=now + timedelta(days=SHARE_DAYS))
    db.add(share)
    db.commit()
    return ShareCreated(code=_pretty(code), sets_count=len(snapshot), expires_at=share.expires_at)


def _find_share(db: Session, code: str) -> ExerciseSetShare:
    share = db.scalar(select(ExerciseSetShare).where(ExerciseSetShare.code == _normalise(code)))
    if share is None or share.expires_at <= utc_now_naive():
        raise AppError(404, NOT_VALID, code="share_code_invalid")      # the same answer for "wrong" and "expired"
    return share


def _usable(db: Session, share: ExerciseSetShare) -> list[dict]:
    """The shared sets that still make sense today (an exercise dropped from the catalogue is skipped)."""
    by_key = entries_by_key(db)
    out = []
    for s in share.snapshot:
        keys = [k for k in s["exercise_keys"] if k in by_key and by_key[k].muscle_group == s["muscle_group"]]
        if keys:
            out.append({"name": s["name"], "muscle_group": s["muscle_group"], "exercise_keys": keys})
    return out


def preview_share(db: Session, code: str) -> SharedPreview:
    share = _find_share(db, code)
    sets = _usable(db, share)
    return SharedPreview(sets_count=len(sets), expires_at=share.expires_at,
                         sets=[SharedSetSummary(name=s["name"], muscle_group=s["muscle_group"], exercise_count=len(s["exercise_keys"])) for s in sets])


def import_share(db: Session, code: str, confirm_replace: bool) -> ImportResult:
    """Replace the caller's whole list with the shared one. Their old sets are deleted, so this needs explicit confirmation."""
    share = _find_share(db, code)
    sets = _usable(db, share)
    if not confirm_replace:
        raise AppError(422, "Confirm that your current sets should be replaced.", code="confirmation_required")
    if not sets:                                          # never wipe someone's list for nothing
        raise AppError(422, "That code has no exercises that can be used any more.", code="nothing_to_import")
    old = db.scalars(select(ExerciseSet)).all()
    try:
        for s in old:
            db.delete(s)
        db.flush()
        for s in sets:
            db.add(ExerciseSet(name=s["name"], muscle_group=s["muscle_group"],
                               items=[ExerciseSetItem(catalogue_key=k, position=i) for i, k in enumerate(s["exercise_keys"])]))
        db.commit()                                       # one transaction: either the whole swap happens or nothing changes
    except Exception:
        db.rollback()
        raise
    return ImportResult(removed=len(old), imported=len(sets), sets=list_sets(db))
