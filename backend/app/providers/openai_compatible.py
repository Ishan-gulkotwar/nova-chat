"""Adapter for any OpenAI-compatible API: OpenAI, Groq, OpenRouter, Together, LM Studio...

These all implement the same two endpoints:
    GET  {base_url}/models
    POST {base_url}/chat/completions   with "stream": true, which answers with SSE:
        data: {"choices": [{"delta": {"content": "Hel"}}]}
        data: {"choices": [{"delta": {"content": "lo"}}]}
        data: [DONE]
"""

import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import ChatMessage, LLMProvider, ModelInfo, ProviderError
from app.providers.http import raise_for_status, transport_error
from app.providers.sse import iter_sse

# /models also lists speech, image and embedding models; hide the ones that can't chat.
# The list is a heuristic: OpenAI-style APIs don't say which models can chat.
NON_CHAT_MARKERS = (
    "whisper", "tts", "orpheus", "playai",  # speech-to-text / text-to-speech
    "embedding", "embed", "dall-e", "image",  # embeddings / image generation
    "moderation", "guard", "transcribe", "audio", "realtime", "search",
)


def is_chat_model(model_id: str) -> bool:
    lowered = model_id.lower()
    return not any(marker in lowered for marker in NON_CHAT_MARKERS)


class OpenAICompatibleProvider(LLMProvider):
    name = "openai"

    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        display_name: str = "OpenAI-compatible",
        timeout_seconds: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._display_name = display_name
        self._timeout = httpx.Timeout(timeout_seconds, connect=10.0)
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        return httpx.AsyncClient(
            base_url=self._base_url, headers=headers, timeout=self._timeout, transport=self._transport
        )

    async def list_models(self) -> list[ModelInfo]:
        try:
            async with self._client() as client:
                response = await client.get("/models")
                await raise_for_status(response, self._display_name)
                data = response.json()
        except httpx.HTTPError as exc:
            raise transport_error(exc, self._display_name, self._base_url) from exc

        ids = sorted(m["id"] for m in data.get("data", []) if is_chat_model(m["id"]))
        return [ModelInfo(id=model_id, name=model_id, provider=self.name) for model_id in ids]

    async def stream_chat(self, model: str, messages: list[ChatMessage]) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "messages": [m.model_dump() for m in messages],
            "stream": True,
        }
        try:
            async with (
                self._client() as client,
                client.stream("POST", "/chat/completions", json=payload) as response,
            ):
                await raise_for_status(response, self._display_name)
                async for event in iter_sse(response):
                    if event.data == "[DONE]":
                        break
                    chunk = json.loads(event.data)
                    if "error" in chunk:
                        raise ProviderError(f"{self._display_name} error: {chunk['error']}")
                    for choice in chunk.get("choices", []):
                        content = (choice.get("delta") or {}).get("content")
                        if content:
                            yield content
        except httpx.HTTPError as exc:
            raise transport_error(exc, self._display_name, self._base_url) from exc
        except json.JSONDecodeError as exc:
            raise ProviderError(f"{self._display_name} returned a malformed response.") from exc
