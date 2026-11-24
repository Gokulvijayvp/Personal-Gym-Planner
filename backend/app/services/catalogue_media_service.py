"""Pictures and videos the user attaches to catalogue exercises. Files live on disk; rows in `catalogue_media`."""
import logging
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.models import CatalogueMedia
from app.schemas.exercise_catalogue import MediaRead

logger = logging.getLogger("app.media")

# content type -> (kind, file extension). SVG is deliberately not allowed (it can carry scripts).
ALLOWED: dict[str, tuple[str, str]] = {
    "image/jpeg": ("image", "jpg"), "image/png": ("image", "png"), "image/webp": ("image", "webp"),
    "image/gif": ("image", "gif"),
    "video/mp4": ("video", "mp4"), "video/webm": ("video", "webm"), "video/quicktime": ("video", "mov"),
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024
MAX_FILES_PER_EXERCISE = 20
CHUNK = 1024 * 1024


def media_root() -> Path:
    if settings.media_dir:
        root = Path(settings.media_dir)
    elif settings.database_url.startswith("sqlite:///") and ":memory:" not in settings.database_url:
        root = Path(settings.database_url.replace("sqlite:///", "", 1)).parent / "media"
    else:
        root = Path("data/media")
    root.mkdir(parents=True, exist_ok=True)
    return root


def to_read(m: CatalogueMedia) -> MediaRead:
    return MediaRead(id=m.id, kind=m.kind, content_type=m.content_type,
                     url=f"{settings.api_v1_prefix}/exercise-catalogue/media/{m.id}/file")


def media_by_key(db: Session) -> dict[str, list[MediaRead]]:
    """Every exercise's media, pictures first (oldest first) and videos last."""
    rows = db.scalars(select(CatalogueMedia).order_by(CatalogueMedia.id)).all()
    out: dict[str, list[CatalogueMedia]] = {}
    for m in rows:
        out.setdefault(m.catalogue_key, []).append(m)
    return {k: [to_read(m) for m in sorted(v, key=lambda m: m.kind == "video")] for k, v in out.items()}


def list_media(db: Session, key: str) -> list[MediaRead]:
    return media_by_key(db).get(key, [])


def _store(upload: UploadFile, kind: str, ext: str) -> tuple[str, int]:
    limit = MAX_IMAGE_BYTES if kind == "image" else MAX_VIDEO_BYTES
    name = f"{uuid.uuid4().hex}.{ext}"
    path = media_root() / name
    size = 0
    try:
        with open(path, "wb") as out:
            while chunk := upload.file.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise AppError(413, f"'{upload.filename}' is too large (max {limit // (1024 * 1024)} MB for a {kind}).",
                                   code="file_too_large")
                out.write(chunk)
        if size == 0:
            raise AppError(400, f"'{upload.filename}' is empty.", code="empty_file")
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return name, size


def add_media(db: Session, key: str, uploads: list[UploadFile]) -> list[MediaRead]:
    from app.services.exercise_catalogue_service import find_entry      # (imported here: that module imports this one)
    if find_entry(db, key) is None:
        raise AppError(404, "That exercise is not in the catalogue.", code="catalogue_item_not_found")
    if not uploads:
        raise AppError(400, "Choose at least one picture or video.", code="no_files")
    existing = len(list_media(db, key))
    if existing + len(uploads) > MAX_FILES_PER_EXERCISE:
        raise AppError(400, f"An exercise can have at most {MAX_FILES_PER_EXERCISE} pictures and videos.", code="too_many_files")
    # check every file's type first so a bad one does not leave the others half-saved
    for u in uploads:
        if (u.content_type or "").lower() not in ALLOWED:
            raise AppError(415, f"'{u.filename}' is not a supported file. Use JPG, PNG, WebP, GIF, MP4, WebM or MOV.",
                           code="unsupported_type")
    saved: list[CatalogueMedia] = []
    try:
        for u in uploads:
            ctype = (u.content_type or "").lower()
            kind, ext = ALLOWED[ctype]
            name, size = _store(u, kind, ext)
            row = CatalogueMedia(catalogue_key=key, kind=kind, content_type=ctype, stored_name=name,
                                 original_name=(u.filename or "")[:255] or None, size_bytes=size)
            db.add(row)
            saved.append(row)
        db.commit()
    except BaseException:
        db.rollback()
        for r in saved:
            (media_root() / r.stored_name).unlink(missing_ok=True)
        raise
    return list_media(db, key)


def get_media(db: Session, media_id: int) -> CatalogueMedia:
    m = db.get(CatalogueMedia, media_id)
    if m is None:
        raise AppError(404, "That picture or video no longer exists.", code="media_not_found")
    return m


def file_path(m: CatalogueMedia) -> Path:
    p = media_root() / m.stored_name
    if not p.is_file():
        raise AppError(404, "The file is missing.", code="media_file_missing")
    return p


def delete_media(db: Session, media_id: int) -> None:
    m = get_media(db, media_id)
    stored = m.stored_name
    db.delete(m)
    db.commit()
    try:
        (media_root() / stored).unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not remove media file %s", stored)
