"""The provider registry: which LLM providers are available right now.

Built per request from the settings (built-in Ollama) plus the enabled rows in
the `provider` table, so changes made in Settings apply immediately. The API
layer asks the registry for a provider by id and never constructs adapters
itself: this is the adapter pattern's "one place that knows every vendor".
"""

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass

from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import Settings
from app.models import ProviderConfig, ProviderKind
from app.providers.anthropic import AnthropicProvider
from app.providers.base import ChatMessage, LLMProvider, ModelInfo, ProviderError
from app.providers.ollama import OllamaProvider
from app.providers.openai_compatible import OpenAICompatibleProvider
from app.security import DecryptionError, Encryptor

OLLAMA_ID = "ollama"
OLLAMA_NAME = "Ollama"
MODEL_LIST_TIMEOUT_SECONDS = 15


class UnknownProviderError(Exception):
    pass


@dataclass(frozen=True)
class RegisteredProvider:
    id: str
    name: str
    kind: str
    provider: LLMProvider


class UnavailableProvider(LLMProvider):
    """Stands in for a provider that can't be used, and explains why on every call."""

    name = "unavailable"

    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def list_models(self) -> list[ModelInfo]:
        raise ProviderError(self.reason)

    async def stream_chat(self, model: str, messages: list[ChatMessage]) -> AsyncIterator[str]:
        raise ProviderError(self.reason)
        yield ""  # pragma: no cover  (makes this an async generator)


def build_provider(config: ProviderConfig, api_key: str | None, settings: Settings) -> LLMProvider:
    """Factory: one configured row -> the matching adapter."""
    timeout = settings.llm_timeout_seconds
    if config.kind == ProviderKind.ANTHROPIC:
        if not api_key:
            return UnavailableProvider(f"{config.name}: an API key is required.")
        return AnthropicProvider(
            api_key=api_key,
            base_url=config.base_url,
            display_name=config.name,
            max_output_tokens=settings.llm_max_output_tokens,
            timeout_seconds=timeout,
        )
    if config.kind == ProviderKind.OPENAI:
        return OpenAICompatibleProvider(
            base_url=config.base_url, api_key=api_key, display_name=config.name, timeout_seconds=timeout
        )
    return UnavailableProvider(f"{config.name}: unsupported provider type '{config.kind}'.")


class ProviderRegistry:
    def __init__(self, entries: list[RegisteredProvider]) -> None:
        self._entries = {entry.id: entry for entry in entries}

    @property
    def entries(self) -> list[RegisteredProvider]:
        return list(self._entries.values())

    def get(self, provider_id: str) -> RegisteredProvider:
        try:
            return self._entries[provider_id]
        except KeyError:
            raise UnknownProviderError(provider_id) from None

    async def list_models(self) -> tuple[list[ModelInfo], list[tuple[RegisteredProvider, str]]]:
        """Ask every provider for its models, concurrently.

        One slow or failing provider doesn't hide the others' models: failures
        are returned separately so the UI can show them as warnings.
        """

        async def models_of(entry: RegisteredProvider) -> list[ModelInfo]:
            models = await asyncio.wait_for(entry.provider.list_models(), MODEL_LIST_TIMEOUT_SECONDS)
            return [m.model_copy(update={"provider": entry.id, "provider_name": entry.name}) for m in models]

        entries = self.entries
        results = await asyncio.gather(*(models_of(e) for e in entries), return_exceptions=True)

        models: list[ModelInfo] = []
        errors: list[tuple[RegisteredProvider, str]] = []
        for entry, result in zip(entries, results, strict=True):
            if isinstance(result, ProviderError):
                errors.append((entry, str(result)))
            elif isinstance(result, TimeoutError):
                errors.append((entry, f"{entry.name} took too long to list its models."))
            elif isinstance(result, BaseException):
                errors.append((entry, f"{entry.name}: unexpected error ({type(result).__name__})."))
            else:
                models.extend(result)
        return models, errors


async def load_registry(session: AsyncSession, settings: Settings, encryptor: Encryptor) -> ProviderRegistry:
    entries: list[RegisteredProvider] = []
    if settings.ollama_enabled:
        entries.append(
            RegisteredProvider(
                id=OLLAMA_ID,
                name=OLLAMA_NAME,
                kind=ProviderKind.OLLAMA,
                provider=OllamaProvider(
                    settings.ollama_base_url, timeout_seconds=settings.llm_timeout_seconds
                ),
            )
        )

    rows = await session.exec(
        select(ProviderConfig).where(col(ProviderConfig.enabled)).order_by(col(ProviderConfig.created_at))
    )
    for config in rows.all():
        try:
            api_key = encryptor.decrypt(config.api_key_encrypted) if config.api_key_encrypted else None
            provider = build_provider(config, api_key, settings)
        except DecryptionError:
            provider = UnavailableProvider(
                f"{config.name}: the saved API key can't be decrypted (SECRET_KEY changed?). "
                "Re-enter it in Settings."
            )
        entries.append(
            RegisteredProvider(id=config.id, name=config.name, kind=config.kind, provider=provider)
        )

    return ProviderRegistry(entries)
