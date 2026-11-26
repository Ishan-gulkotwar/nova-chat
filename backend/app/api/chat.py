"""Chat endpoints: list models and stream a reply over Server-Sent Events (SSE).

SSE is a simple one-way streaming format over plain HTTP. The response stays
open and the server writes events like:

    event: token
    data: {"content": "Hello"}

    (a blank line ends each event)

Event types sent by /api/chat/stream:
    token  -> {"content": str}   a piece of the assistant's reply
    error  -> {"message": str}   the provider failed; the stream ends
    done   -> {}                 the reply is complete
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.providers import ChatMessage, LLMProvider, ModelInfo, OllamaProvider, ProviderError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


def get_provider(settings: Annotated[Settings, Depends(get_settings)]) -> LLMProvider:
    """Dependency that returns the LLM provider.

    Tests override this with a fake. In Phase 4 it becomes a registry lookup
    that picks the provider based on the selected model.
    """
    return OllamaProvider(settings.ollama_base_url, timeout_seconds=settings.llm_timeout_seconds)


ProviderDep = Annotated[LLMProvider, Depends(get_provider)]


class ChatRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    messages: list[ChatMessage] = Field(min_length=1, max_length=500)


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Format one SSE event. JSON never contains raw newlines, so one data line is enough."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get("/models", response_model=list[ModelInfo])
async def list_models(provider: ProviderDep) -> list[ModelInfo]:
    try:
        return await provider.list_models()
    except ProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/chat/stream")
async def stream_chat(body: ChatRequest, request: Request, provider: ProviderDep) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            async for token in provider.stream_chat(body.model, body.messages):
                # The browser aborts the request when the user presses Stop.
                # Returning here closes the provider's generator, which closes
                # the connection to Ollama, so the model stops generating too.
                if await request.is_disconnected():
                    logger.info("Client disconnected; stopping generation")
                    return
                yield sse_event("token", {"content": token})
        except ProviderError as exc:
            yield sse_event("error", {"message": str(exc)})
            return
        yield sse_event("done", {})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # tell reverse proxies (nginx) not to buffer
        },
    )
