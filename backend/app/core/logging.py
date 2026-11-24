import logging
import sys

from app.core.config import settings


def setup_logging() -> None:
    """Configure application loggers (uvicorn keeps managing its own)."""
    app_logger = logging.getLogger("app")
    if app_logger.handlers:  # idempotent (reload / tests)
        return
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s"))
    app_logger.addHandler(handler)
    app_logger.setLevel(logging.DEBUG if settings.app_debug else logging.INFO)
