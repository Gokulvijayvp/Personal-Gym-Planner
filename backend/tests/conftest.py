import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from types import SimpleNamespace

from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import csrf_protect, get_current_user, limit_writes
from app.core import rate_limit
from app.db.scope import USER_KEY
from app.db.session import create_app_engine, get_db
from app.models.user import User
from app.services.auth_service import _claim_unowned_data
from app.main import app

BACKEND = Path(__file__).resolve().parents[1]
TEST_USER_ID = 1       # the signed-in user in feature tests: owns everything those tests create and see


# Set TEST_DATABASE_URL=postgresql+psycopg://user@host:port to run the whole suite against PostgreSQL (what AWS RDS runs).
# Each test then gets its own database cloned from a migrated template. Without it, SQLite files are used, as always.
from dbhelpers import IS_PG, PG_BASE, sync_pg_sequences  # noqa: E402


def _pg_admin():
    import psycopg
    url = PG_BASE.replace("postgresql+psycopg://", "postgresql://", 1)
    return psycopg.connect(f"{url}/postgres", autocommit=True)


@pytest.fixture(scope="session")
def migrated_template(tmp_path_factory):
    """A throwaway DB built by the real Alembic history (so seed data is present): a file for SQLite, a template database for PostgreSQL."""
    if IS_PG:
        name = f"gp_tpl_{os.getpid()}"
        with _pg_admin() as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            admin.execute(f'CREATE DATABASE "{name}"')
        env = {**os.environ, "DATABASE_URL": f"{PG_BASE}/{name}"}
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, check=True, capture_output=True)
        yield f"{PG_BASE}/{name}"
        with _pg_admin() as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        return
    db = tmp_path_factory.mktemp("template") / "template.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}"}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env,
                   check=True, capture_output=True)
    yield db


@pytest.fixture
def db_url(migrated_template, tmp_path) -> str:
    """The URL of this test's own fresh database."""
    if IS_PG:
        import uuid
        name = f"gp_t_{uuid.uuid4().hex[:12]}"
        template = str(migrated_template).rsplit("/", 1)[1]
        with _pg_admin() as admin:
            admin.execute(f'CREATE DATABASE "{name}" TEMPLATE "{template}"')
        yield f"{PG_BASE}/{name}"
        with _pg_admin() as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        return
    path = tmp_path / "test.db"
    shutil.copy(migrated_template, path)
    yield f"sqlite:///{path.as_posix()}"


@pytest.fixture
def db_path(db_url) -> Path:
    """The SQLite file of this test. Tests that open the file directly (sqlite3, PRAGMA) are SQLite-only and skip on PostgreSQL."""
    if IS_PG:
        pytest.skip("SQLite-specific test (it opens the database file directly)")
    return Path(db_url.replace("sqlite:///", "", 1))


@pytest.fixture
def session_factory(db_url, request):
    engine = create_app_engine(db_url)  # same settings as production (SQLite: FKs ON; PostgreSQL: small pool)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, info={USER_KEY: TEST_USER_ID})
    if "anon_client" not in request.fixturenames:        # sign-in tests start with NO accounts, like a fresh install
        with factory() as db:
            if db.get(User, TEST_USER_ID) is None:
                db.add(User(id=TEST_USER_ID, email="tester@example.com", role="admin"))
                db.flush()
                _claim_unowned_data(db, TEST_USER_ID)
                db.commit()
                sync_pg_sequences(db)      # PostgreSQL does not advance its id counter for an explicit id: later inserts would collide
    yield factory
    engine.dispose()


@pytest.fixture(autouse=True)
def _never_send_real_email(monkeypatch):
    """The real .env uses Resend. No test may email anyone: use the console sender and make any real send fail loudly."""
    import resend
    from app.core.config import settings

    def forbidden(params):
        raise AssertionError("a test tried to send a REAL email through Resend")
    monkeypatch.setattr(settings, "email_backend", "console")
    monkeypatch.setattr(resend.Emails, "send", staticmethod(forbidden))


@pytest.fixture(autouse=True)
def _pinned_admin(monkeypatch):
    """The one Admin is whoever ADMIN_EMAIL names. Tests that sign up a first account as the Admin override this fixture
    (same name) in their own module with that address."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "admin_email", "admin@example.com")


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    rate_limit.reset()
    yield
    rate_limit.reset()


@pytest.fixture
def client(session_factory):
    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    def fake_user(db: Session = Depends(get_db)):
        db.info[USER_KEY] = TEST_USER_ID                 # same scoping the real sign-in applies
        return SimpleNamespace(id=TEST_USER_ID, role="admin", email="tester@example.com")

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = fake_user     # the feature tests are not about signing in
    app.dependency_overrides[csrf_protect] = lambda: None
    app.dependency_overrides[limit_writes] = lambda: None
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


@pytest.fixture
def anon_client(session_factory):
    """A client with the real sign-in check, for the authentication tests."""
    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


@pytest.fixture
def ref(client) -> dict:
    """Seeded reference ids: ref['muscle']['Chest'], ref['type']['Barbell'], ref['area']['Chest']['Upper Chest']."""
    groups = client.get("/api/v1/muscle-groups").json()
    types = client.get("/api/v1/workout-types").json()
    return {
        "muscle": {g["name"]: g["id"] for g in groups},
        "type": {t["name"]: t["id"] for t in types},
        "area": {g["name"]: {a["name"]: a["id"] for a in g["target_areas"]} for g in groups},
    }
