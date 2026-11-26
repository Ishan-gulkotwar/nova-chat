"""LLM provider adapters.

Each provider (Ollama now; OpenAI-compatible and Anthropic in Phase 4) implements
the same `LLMProvider` interface, so the API layer never needs to know which
vendor it is talking to.
"""

from app.providers.base import ChatMessage, LLMProvider, ModelInfo, ProviderError
from app.providers.ollama import OllamaProvider

__all__ = ["ChatMessage", "LLMProvider", "ModelInfo", "OllamaProvider", "ProviderError"]
