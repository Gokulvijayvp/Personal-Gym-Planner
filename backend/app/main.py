from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.health import health_check
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.logging import setup_logging
from app.schemas.health import HealthResponse

setup_logging()

@asynccontextmanager
async def lifespan(_: FastAPI):
    """On start: check that the accounts agree with ADMIN_EMAIL (production refuses to start if they do not)."""
    from app.core.admin_state import run_startup_check
    from app.db import session as dbsession
    run_startup_check(dbsession.SessionLocal)
    yield


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_of(value: str) -> str:
    parts = urlsplit(value)
    return f"{parts.scheme}://{parts.netloc}".lower() if parts.scheme and parts.netloc else ""


def create_app() -> FastAPI:
    settings.check_production()          # refuses to start with development secrets or insecure cookies in production
    trusted = [o.lower() for o in settings.cors_origin_list]
    # No debug=True (it would show stack traces). The API docs list every route, so they exist only in development.
    docs = {} if not settings.is_production else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title=settings.app_name, lifespan=lifespan, **docs)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.path.startswith(settings.api_v1_prefix):
            h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")   # the API serves data, never pages
            h.setdefault("Cache-Control", "no-store")                                                 # private data must not sit in caches
        if settings.is_production:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    @app.middleware("http")
    async def trusted_origin_for_writes(request: Request, call_next):
        """Extra CSRF layer: a write from a browser page must come from one of our own origins.
        Requests with no Origin/Referer (curl, Postman) pass this check but still need the session cookie and CSRF token."""
        if request.method in UNSAFE_METHODS:
            source = request.headers.get("origin") or request.headers.get("referer")
            if source and _origin_of(source) not in trusted:
                return JSONResponse(status_code=403, content={"error": {"code": "origin_not_allowed", "message": "This request came from an untrusted site."}})
        return await call_next(request)

    app.add_middleware(               # added last = outermost, so preflight (OPTIONS) is answered before anything else runs
        CORSMiddleware,
        allow_origins=trusted,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "X-CSRF-Token"],
        max_age=600,
    )
    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    # Root-level health check (for uptime checks and the server's own monitoring): open, reveals nothing private.
    @app.get("/health", response_model=HealthResponse, include_in_schema=False)
    def root_health() -> HealthResponse:
        return health_check()

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {"status": "running", "app": settings.app_name}

    return app


app = create_app()
