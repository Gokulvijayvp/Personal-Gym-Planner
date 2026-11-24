from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.schemas.exercise import ExerciseRead
from app.schemas.exercise_catalogue import CatalogueCreate, CatalogueItem, CatalogueResponse, MediaRead
from app.services import catalogue_media_service as media_service
from app.services import exercise_catalogue_service as service

router = APIRouter(prefix="/exercise-catalogue", tags=["Exercise catalogue"])


@router.get("", response_model=CatalogueResponse)
def list_catalogue(db: Session = Depends(get_db)) -> CatalogueResponse:
    """Every built-in exercise, each marked with whether it is already in the user's library."""
    return service.list_catalogue(db)


@router.post("", response_model=CatalogueItem, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_catalogue_exercise(data: CatalogueCreate, db: Session = Depends(get_db)) -> CatalogueItem:
    """Admin only: add a shared exercise to the catalogue. Upload its pictures and videos next, to /{key}/media."""
    return service.create_custom(db, data)


@router.post("/{key}/add", response_model=ExerciseRead, status_code=status.HTTP_201_CREATED)
def add_catalogue_exercise(key: str, response: Response, db: Session = Depends(get_db)) -> ExerciseRead:
    """Copy one catalogue exercise into the library with its standard details. 409 if already there."""
    created = service.add_to_library(db, key)
    response.headers["Location"] = f"/api/v1/exercises/{created.id}"
    return created


@router.post("/{key}/media", response_model=list[MediaRead], status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def upload_media(key: str, files: list[UploadFile] = File(...), db: Session = Depends(get_db)) -> list[MediaRead]:
    """Admin only: attach pictures / videos to a catalogue exercise (everyone then sees them). Returns its full media list."""
    return media_service.add_media(db, key, files)


@router.delete("/media/{media_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def delete_media(media_id: int, db: Session = Depends(get_db)) -> Response:
    media_service.delete_media(db, media_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/media/{media_id}/file", include_in_schema=False)
def media_file(media_id: int, db: Session = Depends(get_db)) -> FileResponse:
    m = media_service.get_media(db, media_id)
    return FileResponse(media_service.file_path(m), media_type=m.content_type,
                        headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"})
