"""Global exception handling.

Every error leaves the API as ``{"error": {"code", "message", "details?", "reference?"}}``.
Internal details (stack traces, SQL, exception text, rejected input values) are logged
server-side only and never returned to the client.
"""
import logging
import uuid
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.schemas.common import ErrorBody, ErrorDetail, ErrorResponse

logger = logging.getLogger("app.errors")

_CODE_BY_STATUS = {
    400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
    405: "method_not_allowed", 409: "conflict", 422: "validation_error",
    429: "too_many_requests",
}


class AppError(Exception):
    """Raise from services/routers for expected business-rule failures."""

    def __init__(self, status_code: int, message: str, code: str | None = None,
                 details: list[ErrorDetail] | None = None, headers: dict[str, str] | None = None) -> None:
        super().__init__(message)
        self.headers = headers
        self.status_code = status_code
        self.message = message
        self.code = code or _CODE_BY_STATUS.get(status_code, "error")
        self.details = details


def _body(status_code: int, code: str, message: str, details: list[ErrorDetail] | None = None,
          reference: str | None = None) -> JSONResponse:
    payload = ErrorResponse(error=ErrorBody(code=code, message=message, details=details, reference=reference))
    return JSONResponse(status_code=status_code, content=payload.model_dump(exclude_none=True))


def _with_cors(request: Request, response: JSONResponse) -> JSONResponse:
    """500s are produced outside CORSMiddleware, so add the headers ourselves.

    Without this a browser would report an opaque network error instead of our JSON.
    """
    origin = request.headers.get("origin")
    if origin and origin in settings.cors_origin_list:
        response.headers["access-control-allow-origin"] = origin
        response.headers["vary"] = "Origin"
    return response


def _field_path(loc: tuple[Any, ...]) -> str:
    """('body', 'items', 0, 'name') -> 'items.0.name' (drops the transport prefix)."""
    parts = [str(p) for p in loc]
    if parts and parts[0] in {"body", "query", "path", "header", "cookie"}:
        parts = parts[1:]
    return ".".join(parts)


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.info("%s %s -> %s %s", request.method, request.url.path, exc.status_code, exc.message)
    response = _body(exc.status_code, exc.code, exc.message, exc.details)
    if exc.headers:
        response.headers.update(exc.headers)
    return response


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = _CODE_BY_STATUS.get(exc.status_code, "error")
    message = exc.detail if isinstance(exc.detail, str) else HTTPStatus(exc.status_code).phrase
    if exc.status_code >= 500:
        logger.error("%s %s -> %s %s", request.method, request.url.path, exc.status_code, message)
    else:
        logger.info("%s %s -> %s %s", request.method, request.url.path, exc.status_code, message)
    response = _body(exc.status_code, code, message)
    if exc.headers:
        response.headers.update(exc.headers)
    return response


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Deliberately omit pydantic's `input`/`ctx`: they echo user data back and can hold objects.
    details = [
        ErrorDetail(field=_field_path(e["loc"]) or None, message=e["msg"], type=e["type"])
        for e in exc.errors()
    ]
    logger.info("%s %s -> 422 validation failed (%d error(s))", request.method, request.url.path, len(details))
    return _body(422, "validation_error", "Some of the submitted values are invalid.", details)


async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    reference = uuid.uuid4().hex[:8]
    # Raw DB message may include table/column names: log it, don't return it.
    logger.warning("%s %s -> 409 integrity error [ref %s]: %s", request.method, request.url.path,
                   reference, exc.orig)
    response = _body(409, "conflict",
                     "This change conflicts with existing data (for example a duplicate or a record still in use).",
                     reference=reference)
    return _with_cors(request, response)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    reference = uuid.uuid4().hex[:8]
    logger.error("Unhandled error on %s %s [ref %s]", request.method, request.url.path, reference,
                 exc_info=(type(exc), exc, exc.__traceback__))
    response = _body(500, "internal_error",
                     "Something went wrong on the server. Please try again.", reference=reference)
    return _with_cors(request, response)


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(IntegrityError, integrity_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_exception_handler)
