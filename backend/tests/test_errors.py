import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.core.errors import AppError, register_exception_handlers
from app.main import app as real_app


def make_app() -> FastAPI:
    """Throwaway app with deliberately failing routes + the real handlers."""
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/items/{item_id}")
    def get_item(item_id: int, limit: int = 10):
        return {"id": item_id, "limit": limit}

    @app.post("/things")
    def create_thing(payload: dict[str, int]):
        return payload

    @app.get("/http-error")
    def http_error():
        raise HTTPException(status_code=404, detail="Exercise not found")

    @app.get("/app-error")
    def app_error():
        raise AppError(409, "A cycle with this name already exists.", code="duplicate_name")

    @app.get("/integrity")
    def integrity():
        raise IntegrityError("INSERT INTO secret_table ...", {}, Exception("UNIQUE constraint failed: secret_table.col"))

    @app.get("/boom")
    def boom():
        raise RuntimeError("db password is hunter2")

    return app


@pytest.fixture
def client() -> TestClient:
    return TestClient(make_app(), raise_server_exceptions=False)


def test_http_exception_uses_envelope(client):
    r = client.get("/http-error")
    assert r.status_code == 404
    assert r.json() == {"error": {"code": "not_found", "message": "Exercise not found"}}


def test_unknown_route_uses_envelope(client):
    r = client.get("/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_method_not_allowed_uses_envelope(client):
    r = client.delete("/http-error")
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "method_not_allowed"


def test_app_error_custom_code(client):
    r = client.get("/app-error")
    assert r.status_code == 409
    assert r.json()["error"] == {"code": "duplicate_name", "message": "A cycle with this name already exists."}


def test_validation_error_lists_fields_without_echoing_input(client):
    r = client.get("/items/abc?limit=SECRET-VALUE")
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    fields = {d["field"] for d in err["details"]}
    assert fields == {"item_id", "limit"}
    assert all({"message", "type"} <= d.keys() for d in err["details"])
    assert "SECRET-VALUE" not in r.text  # rejected input must not be echoed back
    assert "input" not in r.text


def test_validation_error_for_body(client):
    r = client.post("/things", json={"a": "not-an-int"})
    assert r.status_code == 422
    assert r.json()["error"]["details"][0]["field"] == "a"


def test_unexpected_error_is_generic_and_logged(client, caplog):
    with caplog.at_level(logging.ERROR, logger="app.errors"):
        r = client.get("/boom")
    assert r.status_code == 500
    err = r.json()["error"]
    assert err["code"] == "internal_error"
    assert err["message"] == "Something went wrong on the server. Please try again."
    # Nothing internal leaks to the client...
    assert "hunter2" not in r.text and "Traceback" not in r.text and "RuntimeError" not in r.text
    # ...but the server log has the full detail, tied to the reference id.
    record = next(rec for rec in caplog.records if rec.name == "app.errors")
    assert err["reference"] in record.getMessage()
    assert record.exc_info and "hunter2" in str(record.exc_info[1])


def test_integrity_error_is_409_without_db_details(client):
    r = client.get("/integrity")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "conflict"
    assert "secret_table" not in r.text and "UNIQUE" not in r.text


def test_500_carries_cors_header_for_allowed_origin(client):
    r = client.get("/boom", headers={"Origin": "http://localhost:5173"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    r = client.get("/boom", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_real_app_unknown_route_and_existing_endpoints():
    c = TestClient(real_app, raise_server_exceptions=False)
    r = c.get("/api/v1/does-not-exist")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert c.get("/").status_code == 200
    assert c.get("/api/v1/health").status_code == 200
