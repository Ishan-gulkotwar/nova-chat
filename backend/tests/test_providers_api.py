"""API tests for /api/providers and /api/models, and the provider registry."""

from typing import Any

import anyio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import select

from app.api import providers as providers_api
from app.api.providers import get_registry
from app.config import Settings
from app.db import init_db
from app.models import ProviderConfig
from app.providers import ProviderError
from app.providers.registry import ProviderRegistry, RegisteredProvider, UnavailableProvider, load_registry
from app.security import Encryptor
from tests.conftest import FakeProvider

GROQ = {
    "kind": "openai",
    "name": "Groq",
    "base_url": "https://api.groq.com/openai/v1",
    "api_key": "gsk_live_secret_1234",
}


def add(client: TestClient, **overrides: Any) -> dict[str, Any]:
    response = client.post("/api/providers", json={**GROQ, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


async def stored_rows(app: FastAPI) -> list[ProviderConfig]:
    async with app.state.sessionmaker() as session:
        return list((await session.exec(select(ProviderConfig))).all())


def test_create_never_returns_the_key_and_stores_it_encrypted(app: FastAPI, client: TestClient) -> None:
    created = add(client)

    assert "api_key" not in created
    assert created["has_api_key"] is True
    assert created["api_key_hint"] == "…1234"
    assert "gsk_live_secret_1234" not in client.get("/api/providers").text

    [row] = anyio.run(stored_rows, app)
    assert row.api_key_encrypted and "gsk_live_secret_1234" not in row.api_key_encrypted
    assert app.state.encryptor.decrypt(row.api_key_encrypted) == "gsk_live_secret_1234"


def test_list_includes_builtin_ollama_first(client: TestClient) -> None:
    add(client)
    providers = client.get("/api/providers").json()
    assert providers[0]["id"] == "ollama" and providers[0]["builtin"] is True
    assert providers[0]["enabled"] is False  # disabled in the test settings
    assert providers[1]["name"] == "Groq"


def test_update_replaces_and_removes_key_and_toggles(client: TestClient) -> None:
    provider = add(client)
    url = f"/api/providers/{provider['id']}"

    updated = client.patch(url, json={"api_key": "gsk_new_key_abcd9999"}).json()
    assert updated["api_key_hint"] == "…9999"

    updated = client.patch(url, json={"name": "Groq (free)", "enabled": False}).json()
    assert (updated["name"], updated["enabled"], updated["api_key_hint"]) == ("Groq (free)", False, "…9999")

    updated = client.patch(url, json={"api_key": ""}).json()
    assert (updated["has_api_key"], updated["api_key_hint"]) == (False, None)


def test_delete_provider(client: TestClient) -> None:
    provider = add(client)
    assert client.delete(f"/api/providers/{provider['id']}").status_code == 204
    assert [p["id"] for p in client.get("/api/providers").json()] == ["ollama"]


@pytest.mark.parametrize(
    "body",
    [
        {**GROQ, "base_url": "not a url"},
        {**GROQ, "kind": "something-else"},
        {**GROQ, "name": ""},
        {"kind": "anthropic", "name": "Claude", "base_url": "https://api.anthropic.com"},  # key required
    ],
)
def test_create_validation(client: TestClient, body: dict[str, Any]) -> None:
    assert client.post("/api/providers", json=body).status_code == 422


def test_builtin_ollama_cannot_be_edited_or_added(client: TestClient) -> None:
    assert client.patch("/api/providers/ollama", json={"name": "x"}).status_code == 400
    assert client.post("/api/providers", json={**GROQ, "kind": "ollama"}).status_code == 400


def test_test_endpoint_reports_success_and_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = add(client)
    fake = FakeProvider()
    seen_keys: list[str | None] = []

    def fake_build(config: ProviderConfig, api_key: str | None, settings: Settings) -> FakeProvider:
        seen_keys.append(api_key)
        return fake

    monkeypatch.setattr(providers_api, "build_provider", fake_build)

    assert client.post(f"/api/providers/{provider['id']}/test").json() == {
        "ok": True,
        "model_count": 1,
        "error": None,
    }
    assert seen_keys == ["gsk_live_secret_1234"]  # decrypted for the call

    fake.fail = True
    result = client.post(f"/api/providers/{provider['id']}/test").json()
    assert result["ok"] is False and "Could not connect" in result["error"]


def test_models_endpoint_reports_failing_providers_without_hiding_others(
    app: FastAPI, client: TestClient
) -> None:
    working, broken = FakeProvider(), FakeProvider(fail=True)
    registry = ProviderRegistry(
        [
            RegisteredProvider(id="a", name="Working", kind="fake", provider=working),
            RegisteredProvider(id="b", name="Broken", kind="fake", provider=broken),
        ]
    )
    app.dependency_overrides[get_registry] = lambda: registry

    body = client.get("/api/models").json()

    assert body["models"] == [
        {
            "id": "fake-model",
            "name": "fake-model",
            "provider": "a",
            "provider_name": "Working",
            "size_bytes": None,
        }
    ]
    assert body["errors"] == [
        {"provider": "b", "provider_name": "Broken", "message": "Could not connect to Ollama"}
    ]


async def test_registry_skips_disabled_and_flags_undecryptable_keys(app: FastAPI) -> None:
    settings: Settings = app.state.settings
    other_key = Encryptor("a-completely-different-secret-key-000")
    await init_db(app.state.engine)  # no TestClient here, so create the tables directly
    async with app.state.sessionmaker() as session:
        session.add(ProviderConfig(kind="openai", name="Off", base_url="https://x.test", enabled=False))
        session.add(
            ProviderConfig(
                kind="openai",
                name="Bad key",
                base_url="https://y.test",
                api_key_encrypted=other_key.encrypt("k"),
            )
        )
        await session.commit()

        registry = await load_registry(session, settings, app.state.encryptor)

    [entry] = registry.entries
    assert entry.name == "Bad key"
    assert isinstance(entry.provider, UnavailableProvider)
    with pytest.raises(ProviderError, match="can't be decrypted"):
        await entry.provider.list_models()
