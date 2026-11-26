"""API tests for /api/models."""

from fastapi.testclient import TestClient

from tests.conftest import FakeProvider


def test_list_models(client: TestClient, provider: FakeProvider) -> None:
    response = client.get("/api/models")
    assert response.status_code == 200
    assert response.json() == [
        {"id": "fake-model", "name": "fake-model", "provider": "fake", "size_bytes": None}
    ]


def test_list_models_provider_down_returns_502(client: TestClient, provider: FakeProvider) -> None:
    provider.fail = True
    response = client.get("/api/models")
    assert response.status_code == 502
    assert "Could not connect" in response.json()["detail"]
