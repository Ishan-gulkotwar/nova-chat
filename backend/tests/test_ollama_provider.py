"""Unit tests for the Ollama adapter, using httpx.MockTransport (no real Ollama needed)."""

import json

import httpx
import pytest

from app.providers import ChatMessage, OllamaProvider, ProviderError


def make_provider(handler) -> OllamaProvider:  # type: ignore[no-untyped-def]
    return OllamaProvider("http://ollama.test", transport=httpx.MockTransport(handler))


async def collect(provider: OllamaProvider, model: str = "llama3.2") -> list[str]:
    messages = [ChatMessage(role="user", content="hi")]
    return [chunk async for chunk in provider.stream_chat(model, messages)]


async def test_list_models_maps_ollama_tags() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/tags"
        return httpx.Response(200, json={"models": [{"name": "llama3.2:latest", "size": 2019393189}]})

    models = await make_provider(handler).list_models()

    assert len(models) == 1
    assert models[0].id == "llama3.2:latest"
    assert models[0].name == "llama3.2"
    assert models[0].provider == "ollama"


async def test_stream_chat_yields_content_chunks() -> None:
    ndjson = "\n".join(
        json.dumps(line)
        for line in [
            {"message": {"role": "assistant", "content": "Hel"}, "done": False},
            {"message": {"role": "assistant", "content": "lo"}, "done": False},
            {"message": {"role": "assistant", "content": ""}, "done": True},
        ]
    )

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["model"] == "llama3.2"
        assert body["stream"] is True
        assert body["messages"] == [{"role": "user", "content": "hi"}]
        return httpx.Response(200, text=ndjson)

    assert await collect(make_provider(handler)) == ["Hel", "lo"]


async def test_stream_chat_unknown_model_raises_provider_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "model 'nope' not found"})

    with pytest.raises(ProviderError, match="model 'nope' not found"):
        await collect(make_provider(handler), model="nope")


async def test_connection_failure_raises_friendly_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(ProviderError, match="Is Ollama running"):
        await make_provider(handler).list_models()
