"""Shared pytest fixtures. pytest loads this file automatically."""

from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.chat import get_provider
from app.config import Settings
from app.main import create_app
from app.providers import ChatMessage, LLMProvider, ModelInfo, ProviderError


class FakeProvider(LLMProvider):
    """Deterministic stand-in for a real LLM. Records what it was asked."""

    name = "fake"

    def __init__(self, chunks: list[str] | None = None, fail: bool = False) -> None:
        self.chunks = chunks if chunks is not None else ["Hello", ", ", "world"]
        self.fail = fail
        self.calls: list[tuple[str, list[ChatMessage]]] = []

    async def list_models(self) -> list[ModelInfo]:
        if self.fail:
            raise ProviderError("Could not connect to Ollama")
        return [ModelInfo(id="fake-model", name="fake-model", provider=self.name)]

    async def stream_chat(self, model: str, messages: list[ChatMessage]) -> AsyncIterator[str]:
        self.calls.append((model, messages))
        for chunk in self.chunks:
            yield chunk
        if self.fail:
            raise ProviderError("model crashed")


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    """A fresh app with its own throwaway SQLite database for each test."""
    settings = Settings(environment="test", database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    return create_app(settings)


@pytest.fixture
def provider(app: FastAPI) -> FakeProvider:
    """The fake LLM, swapped in via FastAPI's dependency overrides."""
    fake = FakeProvider()
    app.dependency_overrides[get_provider] = lambda: fake
    return fake


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    # Using TestClient as a context manager runs the app's startup (creates tables).
    with TestClient(app) as test_client:
        yield test_client
