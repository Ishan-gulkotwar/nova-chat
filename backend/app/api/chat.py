"""Model listing, the LLM provider dependency and the SSE helper.

The streaming chat endpoint itself lives in conversations.py, because every
reply now belongs to a saved conversation.
"""

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import Settings, get_settings
from app.providers import LLMProvider, ModelInfo, OllamaProvider, ProviderError

router = APIRouter(tags=["models"])


def get_provider(settings: Annotated[Settings, Depends(get_settings)]) -> LLMProvider:
    """Dependency that returns the LLM provider.

    Tests override this with a fake. In Phase 4 it becomes a registry lookup
    that picks the provider based on the selected model.
    """
    return OllamaProvider(settings.ollama_base_url, timeout_seconds=settings.llm_timeout_seconds)


ProviderDep = Annotated[LLMProvider, Depends(get_provider)]


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Format one Server-Sent Event. JSON has no raw newlines, so one data line is enough."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get("/models", response_model=list[ModelInfo])
async def list_models(provider: ProviderDep) -> list[ModelInfo]:
    try:
        return await provider.list_models()
    except ProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
