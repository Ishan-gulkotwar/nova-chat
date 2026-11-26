"""API tests for /api/models and /api/chat/stream, using a fake provider."""

import json
from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.chat import get_provider
from app.providers import ChatMessage, LLMProvider, ModelInfo, ProviderError


class FakeProvider(LLMProvider):
    """Deterministic stand-in for a real LLM."""

    name = "fake"

    def __init__(self, chunks: list[str] | None = None, fail: bool = False) -> None:
        self.chunks = chunks or ["Hello", ", ", "world"]
        self.fail = fail
        self.received: list[ChatMessage] = []

    async def list_models(self) -> list[ModelInfo]:
        if self.fail:
            raise ProviderError("Could not connect to Ollama")
        return [ModelInfo(id="fake-model", name="fake-model", provider=self.name)]

    async def stream_chat(self, model: str, messages: list[ChatMessage]) -> AsyncIterator[str]:
        self.received = messages
        for chunk in self.chunks:
            yield chunk
        if self.fail:
            raise ProviderError("model crashed")


def use_provider(app: FastAPI, provider: LLMProvider) -> None:
    """Swap the real provider for a fake via FastAPI's dependency overrides."""
    app.dependency_overrides[get_provider] = lambda: provider


def parse_sse(text: str) -> list[tuple[str, dict]]:  # type: ignore[type-arg]
    """Turn an SSE body into [(event, data), ...]."""
    events = []
    for block in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((fields["event"], json.loads(fields["data"])))
    return events


CHAT_BODY = {"model": "fake-model", "messages": [{"role": "user", "content": "Hi"}]}


def test_list_models(app: FastAPI, client: TestClient) -> None:
    use_provider(app, FakeProvider())
    response = client.get("/api/models")
    assert response.status_code == 200
    assert response.json() == [
        {"id": "fake-model", "name": "fake-model", "provider": "fake", "size_bytes": None}
    ]


def test_list_models_provider_down_returns_502(app: FastAPI, client: TestClient) -> None:
    use_provider(app, FakeProvider(fail=True))
    response = client.get("/api/models")
    assert response.status_code == 502
    assert "Could not connect" in response.json()["detail"]


def test_stream_sends_tokens_then_done(app: FastAPI, client: TestClient) -> None:
    provider = FakeProvider()
    use_provider(app, provider)

    response = client.post("/api/chat/stream", json=CHAT_BODY)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert parse_sse(response.text) == [
        ("token", {"content": "Hello"}),
        ("token", {"content": ", "}),
        ("token", {"content": "world"}),
        ("done", {}),
    ]
    assert provider.received == [ChatMessage(role="user", content="Hi")]


def test_stream_reports_provider_error_as_event(app: FastAPI, client: TestClient) -> None:
    use_provider(app, FakeProvider(chunks=["partial"], fail=True))

    events = parse_sse(client.post("/api/chat/stream", json=CHAT_BODY).text)

    assert events == [("token", {"content": "partial"}), ("error", {"message": "model crashed"})]


@pytest.mark.parametrize(
    "body",
    [
        {"model": "fake-model", "messages": []},
        {"model": "", "messages": [{"role": "user", "content": "Hi"}]},
        {"model": "fake-model", "messages": [{"role": "robot", "content": "Hi"}]},
    ],
)
def test_stream_validates_request(app: FastAPI, client: TestClient, body: dict) -> None:  # type: ignore[type-arg]
    use_provider(app, FakeProvider())
    assert client.post("/api/chat/stream", json=body).status_code == 422
