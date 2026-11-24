from datetime import timezone

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.core.timezone import get_app_tz, utc_now_naive
from app.api.deps import get_current_user, require_admin
from app.db.session import get_db
from app.schemas.app_settings import DataInfo, ResetRequest, SettingsInput, SettingsRead
from app.services import settings_service as service

router = APIRouter(prefix="/settings", tags=["Settings"])


@router.get("", response_model=SettingsRead)
def read_settings(db: Session = Depends(get_db)):
    return service.get_settings(db)


@router.put("", response_model=SettingsRead)
def update_settings(payload: SettingsInput, db: Session = Depends(get_db)):
    return service.update_settings(db, payload)


@router.post("/reset", response_model=SettingsRead)
def reset_settings(payload: ResetRequest, db: Session = Depends(get_db)):
    """Restore one section (or everything) to the built-in defaults. Plans and history are untouched."""
    return service.reset_settings(db, payload.section)


@router.get("/data", response_model=DataInfo)
def read_data_info(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Your own counts (everyone). The server facts and the backup details are returned to the Admin only."""
    return service.data_info(db, include_server=user.role == "admin")


@router.get("/data/backup", dependencies=[Depends(require_admin)])
def download_backup(db: Session = Depends(get_db)):
    """Admin only: a snapshot of the WHOLE database (every user's data and the account tables) as a .db file."""
    path = service.create_backup_file(db)
    stamp = utc_now_naive().replace(tzinfo=timezone.utc).astimezone(get_app_tz()).strftime("%Y%m%d-%H%M")
    return FileResponse(
        path, media_type="application/vnd.sqlite3", filename=f"gym-planner-backup-{stamp}.db",
        headers={"Cache-Control": "no-store"}, background=BackgroundTask(path.unlink, missing_ok=True),
    )
