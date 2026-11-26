"""Unit tests for the OpenAI-compatible and Anthropic adapters (httpx.MockTransport, no network)."""

import json

import httpx
import pytest

from app.providers import ChatMessage, ProviderError
from app.providers.anthropic import ANTHROPIC_API_VERSION, AnthropicProvider, to_anthropic_payload
from app.providers.openai_compatible import OpenAICompatibleProvider


def sse(*events: tuple[str | None, object]) -> str:
    out = []
    for event, data in events:
        line = f"event: {event}\n" if event else ""
        out.append(f"{line}data: {data if isinstance(data, str) else json.dumps(data)}\n\n")
    return "".join(out)


def text_delta(text: str) -> dict[str, str]:
    return {"type": "text_delta", "text": text}


MESSAGES = [
    ChatMessage(role="system", content="Be brief."),
    ChatMessage(role="user", content="Hi"),
]


# ---- OpenAI-compatible --------------------------------------------------------


def openai(handler) -> OpenAICompatibleProvider:  # type: ignore[no-untyped-def]
    return OpenAICompatibleProvider(
        "https://api.groq.test/openai/v1",
        api_key="gsk_test",
        display_name="Groq",
        transport=httpx.MockTransport(handler),
    )


async def test_openai_lists_only_chat_models() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/openai/v1/models"
        assert request.headers["authorization"] == "Bearer gsk_test"
        ids = [
            "llama-3.3-70b-versatile",
            "whisper-large-v3",
            "text-embedding-3-small",
            "canopylabs/orpheus-v1-english",
            "gpt-4o-mini",
        ]
        return httpx.Response(200, json={"data": [{"id": i} for i in ids]})

    models = await openai(handler).list_models()
    assert [m.id for m in models] == ["gpt-4o-mini", "llama-3.3-70b-versatile"]


async def test_openai_streams_deltas_until_done() -> None:
    body = sse(
        (None, {"choices": [{"delta": {"role": "assistant"}}]}),
        (None, {"choices": [{"delta": {"content": "Hel"}}]}),
        (None, {"choices": [{"delta": {"content": "lo"}}]}),
        (None, "[DONE]"),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/openai/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["stream"] is True
        assert payload["messages"][0] == {"role": "system", "content": "Be brief."}
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    chunks = [c async for c in openai(handler).stream_chat("llama-3.3-70b-versatile", MESSAGES)]
    assert chunks == ["Hel", "lo"]


async def test_openai_bad_key_gives_clear_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "Invalid API Key"}})

    with pytest.raises(ProviderError, match="rejected the API key.*Invalid API Key"):
        await openai(handler).list_models()


async def test_openai_rate_limit_message() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "slow down"}})

    with pytest.raises(ProviderError, match="rate limit"):
        _ = [c async for c in openai(handler).stream_chat("m", MESSAGES)]


# ---- Anthropic ----------------------------------------------------------------


def anthropic(handler) -> AnthropicProvider:  # type: ignore[no-untyped-def]
    return AnthropicProvider(
        api_key="sk-ant-test",
        base_url="https://api.anthropic.test",
        max_output_tokens=512,
        transport=httpx.MockTransport(handler),
    )


def test_anthropic_payload_moves_system_out_and_merges_same_role_turns() -> None:
    system, turns = to_anthropic_payload(
        [
            ChatMessage(role="system", content="Be brief."),
            ChatMessage(role="user", content="First"),
            ChatMessage(role="user", content="Second"),  # e.g. the reply in between failed
            ChatMessage(role="assistant", content="Answer"),
        ]
    )
    assert system == "Be brief."
    assert turns == [
        {"role": "user", "content": "First\n\nSecond"},
        {"role": "assistant", "content": "Answer"},
    ]


async def test_anthropic_lists_models_with_display_names() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        assert request.headers["x-api-key"] == "sk-ant-test"
        assert request.headers["anthropic-version"] == ANTHROPIC_API_VERSION
        return httpx.Response(200, json={"data": [{"id": "claude-x-1", "display_name": "Claude X"}]})

    models = await anthropic(handler).list_models()
    assert [(m.id, m.name) for m in models] == [("claude-x-1", "Claude X")]


async def test_anthropic_streams_text_deltas() -> None:
    body = sse(
        ("message_start", {"type": "message_start", "message": {}}),
        ("content_block_start", {"type": "content_block_start", "index": 0}),
        ("ping", {"type": "ping"}),
        ("content_block_delta", {"type": "content_block_delta", "delta": text_delta("Hi")}),
        ("content_block_delta", {"type": "content_block_delta", "delta": text_delta("!")}),
        ("message_stop", {"type": "message_stop"}),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["system"] == "Be brief."
        assert payload["messages"] == [{"role": "user", "content": "Hi"}]
        assert payload["max_tokens"] == 512
        return httpx.Response(200, text=body)

    assert [c async for c in anthropic(handler).stream_chat("claude-x-1", MESSAGES)] == ["Hi", "!"]


async def test_anthropic_error_event_raises() -> None:
    body = sse(("error", {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=body)

    with pytest.raises(ProviderError, match="Overloaded"):
        _ = [c async for c in anthropic(handler).stream_chat("claude-x-1", MESSAGES)]
