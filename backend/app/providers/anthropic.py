"""Adapter for Anthropic's Messages API (Claude models).

Differences from the OpenAI format that this adapter handles:
  * Authentication uses an `x-api-key` header plus an `anthropic-version` header.
  * The system prompt is a separate top-level `system` field, not a message.
  * `max_tokens` is required.
  * Messages should alternate user/assistant, so consecutive same-role
    messages are merged.
  * Streaming SSE events are typed, and text arrives in `content_block_delta`:
        event: content_block_delta
        data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hel"}}
Docs: https://docs.claude.com/en/api/messages
"""

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.providers.base import ChatMessage, LLMProvider, ModelInfo, ProviderError
from app.providers.http import raise_for_status, transport_error
from app.providers.sse import iter_sse

ANTHROPIC_API_VERSION = "2023-06-01"
DEFAULT_BASE_URL = "https://api.anthropic.com"


def to_anthropic_payload(messages: list[ChatMessage]) -> tuple[str, list[dict[str, Any]]]:
    """Split out the system prompt and merge consecutive same-role turns."""
    system = "\n\n".join(m.content for m in messages if m.role == "system")
    turns: list[dict[str, Any]] = []
    for message in messages:
        if message.role == "system":
            continue
        if turns and turns[-1]["role"] == message.role:
            turns[-1]["content"] += "\n\n" + message.content
        else:
            turns.append({"role": message.role, "content": message.content})
    return system, turns


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        display_name: str = "Anthropic",
        max_output_tokens: int = 4096,
        timeout_seconds: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._display_name = display_name
        self._max_output_tokens = max_output_tokens
        self._timeout = httpx.Timeout(timeout_seconds, connect=10.0)
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        headers = {"x-api-key": self._api_key, "anthropic-version": ANTHROPIC_API_VERSION}
        return httpx.AsyncClient(
            base_url=self._base_url, headers=headers, timeout=self._timeout, transport=self._transport
        )

    async def list_models(self) -> list[ModelInfo]:
        try:
            async with self._client() as client:
                response = await client.get("/v1/models", params={"limit": 100})
                await raise_for_status(response, self._display_name)
                data = response.json()
        except httpx.HTTPError as exc:
            raise transport_error(exc, self._display_name, self._base_url) from exc

        return [
            ModelInfo(id=m["id"], name=m.get("display_name") or m["id"], provider=self.name)
            for m in data.get("data", [])
        ]

    async def stream_chat(self, model: str, messages: list[ChatMessage]) -> AsyncIterator[str]:
        system, turns = to_anthropic_payload(messages)
        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": self._max_output_tokens,
            "messages": turns,
            "stream": True,
        }
        if system:
            payload["system"] = system
        try:
            async with (
                self._client() as client,
                client.stream("POST", "/v1/messages", json=payload) as response,
            ):
                await raise_for_status(response, self._display_name)
                async for event in iter_sse(response):
                    data = json.loads(event.data)
                    kind = data.get("type", event.event)
                    if kind == "content_block_delta":
                        delta = data.get("delta", {})
                        if delta.get("type") == "text_delta" and delta.get("text"):
                            yield delta["text"]
                    elif kind == "error":
                        message = data.get("error", {}).get("message", "unknown error")
                        raise ProviderError(f"{self._display_name} error: {message}")
                    elif kind == "message_stop":
                        break
        except httpx.HTTPError as exc:
            raise transport_error(exc, self._display_name, self._base_url) from exc
        except json.JSONDecodeError as exc:
            raise ProviderError(f"{self._display_name} returned a malformed response.") from exc
