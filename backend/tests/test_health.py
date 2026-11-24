from datetime import date, datetime

from fastapi.testclient import TestClient
from app.core.timezone import today_local
from app.main import app

client = TestClient(app)

def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "running"

def test_health():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

def test_health_time_fields():
    body = client.get("/api/v1/health").json()
    assert body["timezone"] == "Asia/Kolkata"
    assert body["server_time"].endswith("Z")
    datetime.fromisoformat(body["server_time"].replace("Z", "+00:00"))
    # Compare against the same instant the server reported, so a midnight rollover can't flake this.
    reported = datetime.fromisoformat(body["server_time"].replace("Z", "+00:00"))
    assert date.fromisoformat(body["today"]) == today_local(reported)

def test_dashboard_uses_app_timezone_date(client):
    # `client` is the conftest fixture (temporary database), not the module-level one.
    assert client.get("/api/v1/dashboard").json()["date"] == today_local().isoformat()
