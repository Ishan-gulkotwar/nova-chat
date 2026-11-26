"""Ollama adapter: talks to a local Ollama server over its HTTP API.

Ollama streams chat replies as NDJSON (one JSON object per line):
    {"message": {"role": "assistant", "content": "Hel"}, "done": false}
    {"message": {"role": "assistant", "content": "lo"},  "done": false}
    {"done": true, ...stats}
API reference: https://github.com/ollama/ollama/blob/main/docs/api.md
"""

import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import ChatMessage, LLMProvider, ModelInfo, ProviderError


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(
        self,
        base_url: str,
        timeout_seconds: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        # Fail fast if Ollama isn't running (connect), but allow slow generation (read).
        self._timeout = httpx.Timeout(timeout_seconds, connect=5.0)
        # Tests inject httpx.MockTransport here instead of hitting a real server.
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url, timeout=self._timeout, transport=self._transport
        )

    async def list_models(self) -> list[ModelInfo]:
        try:
            async with self._client() as client:
                response = await client.get("/api/tags")
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise ProviderError(self._unreachable_message(exc)) from exc

        return [
            ModelInfo(
                id=model["name"],
                name=model["name"].removesuffix(":latest"),
                provider=self.name,
                size_bytes=model.get("size"),
            )
            for model in data.get("models", [])
        ]

    async def stream_chat(self, model: str, messages: list[ChatMessage]) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "messages": [m.model_dump() for m in messages],
            "stream": True,
        }
        try:
            async with (
                self._client() as client,
                client.stream("POST", "/api/chat", json=payload) as response,
            ):
                if response.status_code != 200:
                    body = (await response.aread()).decode(errors="replace")
                    raise ProviderError(self._error_from_body(body, response.status_code))

                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    if "error" in chunk:
                        raise ProviderError(f"Ollama error: {chunk['error']}")
                    content = chunk.get("message", {}).get("content", "")
                    if content:
                        yield content
                    if chunk.get("done"):
                        break
        except httpx.HTTPError as exc:
            raise ProviderError(self._unreachable_message(exc)) from exc
        except json.JSONDecodeError as exc:
            raise ProviderError("Ollama returned a malformed response.") from exc

    def _unreachable_message(self, exc: httpx.HTTPError) -> str:
        if isinstance(exc, httpx.ConnectError):
            return f"Could not connect to Ollama at {self._base_url}. Is Ollama running?"
        if isinstance(exc, httpx.TimeoutException):
            return "Ollama took too long to respond."
        return f"Ollama request failed: {exc}"

    @staticmethod
    def _error_from_body(body: str, status: int) -> str:
        try:
            detail = json.loads(body).get("error", body)
        except json.JSONDecodeError:
            detail = body or "no details"
        return f"Ollama error ({status}): {detail}"
