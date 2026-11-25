"""Tests for the system endpoints."""

import pytest
from fastapi.testclient import TestClient

from app import __version__
from app.config import Settings
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    """A test client backed by a fresh app with test settings."""
    app = create_app(Settings(environment="test"))
    return TestClient(app)


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


def test_hello_default_name(client: TestClient) -> None:
    response = client.get("/api/hello")
    assert response.status_code == 200
    assert response.json()["message"].startswith("Hello, world!")


def test_hello_custom_name(client: TestClient) -> None:
    response = client.get("/api/hello", params={"name": "Ishan"})
    assert response.status_code == 200
    assert "Hello, Ishan!" in response.json()["message"]


def test_hello_rejects_overlong_name(client: TestClient) -> None:
    response = client.get("/api/hello", params={"name": "x" * 51})
    assert response.status_code == 422  # FastAPI validation error


def test_cors_allows_configured_origin(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
