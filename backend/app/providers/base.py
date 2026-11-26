"""The provider-agnostic interface every LLM backend implements."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["system", "user", "assistant"]


class ChatMessage(BaseModel):
    """One turn of a conversation, in the shape every provider understands."""

    role: Role
    content: str = Field(max_length=100_000)


class ModelInfo(BaseModel):
    """A model the user can pick in the UI."""

    id: str  # the identifier sent back when chatting, e.g. "llama3.2:latest"
    name: str  # human-friendly label
    provider: str  # which adapter serves it, e.g. "ollama"
    size_bytes: int | None = None


class ProviderError(Exception):
    """An upstream LLM provider failed: unreachable, unknown model, bad response, etc.

    The message is safe to show to the user.
    """


class LLMProvider(ABC):
    """Adapter interface. One subclass per vendor."""

    name: str

    @abstractmethod
    async def list_models(self) -> list[ModelInfo]:
        """Return the models this provider can serve right now."""

    @abstractmethod
    def stream_chat(self, model: str, messages: list[ChatMessage]) -> AsyncIterator[str]:
        """Yield the assistant's reply as text chunks, as soon as they arrive.

        Implementations are async generators. If the consumer stops iterating
        (e.g. the user pressed Stop), the generator is closed, which must close
        the upstream connection so the model stops generating.
        """
