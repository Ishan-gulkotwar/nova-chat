"""LLM provider adapters.

Each provider (Ollama, any OpenAI-compatible API, Anthropic) implements the same
`LLMProvider` interface, so the API layer never needs to know which vendor it
is talking to. `registry.py` decides which providers are available.
"""

from app.providers.base import ChatMessage, LLMProvider, ModelInfo, ProviderError
from app.providers.ollama import OllamaProvider

__all__ = ["ChatMessage", "LLMProvider", "ModelInfo", "OllamaProvider", "ProviderError"]
