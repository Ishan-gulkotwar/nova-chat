"""Conversations: CRUD, search, and streaming a reply that gets saved.

Routes (all under /api/conversations):
    GET    /                         list, newest first; ?q= searches titles and messages
    POST   /                         create
    GET    /{id}                     one conversation with all its messages
    PATCH  /{id}                     rename / change system prompt / model
    DELETE /{id}                     delete it and its messages
    POST   /{id}/messages/stream     send a message, stream the reply (SSE)

SSE events from the stream endpoint:
    token -> {"content": str}
    error -> {"message": str, "message_id": int}   (sent after the partial reply is saved)
    done  -> {"message_id": int}                   (sent after the reply is saved)
"""

import logging
from collections.abc import AsyncIterator, Sequence

import anyio
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlmodel import col, delete, or_, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.providers import RegistryDep
from app.api.sse import sse_event
from app.db import SessionDep, SessionMaker
from app.models import DEFAULT_TITLE, Conversation, Message, MessageStatus, utcnow
from app.providers import ChatMessage, ProviderError
from app.providers.registry import UnknownProviderError
from app.schemas import (
    ConversationCreate,
    ConversationDetail,
    ConversationRead,
    ConversationUpdate,
    MessageRead,
    SendMessageRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/conversations", tags=["conversations"])

TITLE_MAX_CHARS = 60


async def get_conversation_or_404(session: AsyncSession, conversation_id: str) -> Conversation:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


async def get_messages(session: AsyncSession, conversation_id: str) -> Sequence[Message]:
    result = await session.exec(
        select(Message).where(Message.conversation_id == conversation_id).order_by(col(Message.id))
    )
    return result.all()


def title_from_message(content: str) -> str:
    """A quick automatic title: the first line of the first message, shortened."""
    first_line = " ".join(content.strip().split("\n", 1)[0].split())
    if len(first_line) <= TITLE_MAX_CHARS:
        return first_line or DEFAULT_TITLE
    return first_line[: TITLE_MAX_CHARS - 1].rstrip() + "…"


def build_prompt(conversation: Conversation, history: Sequence[Message]) -> list[ChatMessage]:
    """System prompt (if any) followed by every usable earlier turn."""
    prompt = []
    if conversation.system_prompt.strip():
        prompt.append(ChatMessage(role="system", content=conversation.system_prompt))
    prompt += [
        ChatMessage(role=m.role, content=m.content)  # type: ignore[arg-type]
        for m in history
        if m.status != MessageStatus.ERROR and m.content
    ]
    return prompt


# ---- CRUD -------------------------------------------------------------------


@router.get("", response_model=list[ConversationRead])
async def list_conversations(
    session: SessionDep,
    q: str | None = Query(default=None, max_length=200, description="Search titles and message text"),
    limit: int = Query(default=100, ge=1, le=500),
) -> Sequence[Conversation]:
    statement = select(Conversation).order_by(col(Conversation.updated_at).desc()).limit(limit)
    if q and q.strip():
        term = q.strip()
        # A conversation matches if its title or any of its messages contains the term.
        matching_messages = select(Message.conversation_id).where(
            col(Message.content).icontains(term, autoescape=True)
        )
        statement = statement.where(
            or_(
                col(Conversation.title).icontains(term, autoescape=True),
                col(Conversation.id).in_(matching_messages),
            )
        )
    result = await session.exec(statement)
    return result.all()


@router.post("", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(body: ConversationCreate, session: SessionDep) -> Conversation:
    conversation = Conversation(
        title=body.title or DEFAULT_TITLE,
        model=body.model,
        provider=body.provider,
        system_prompt=body.system_prompt,
    )
    session.add(conversation)
    await session.commit()
    return conversation


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(conversation_id: str, session: SessionDep) -> ConversationDetail:
    conversation = await get_conversation_or_404(session, conversation_id)
    messages = await get_messages(session, conversation_id)
    return ConversationDetail(
        **ConversationRead.model_validate(conversation).model_dump(),
        messages=[MessageRead.model_validate(m) for m in messages],
    )


@router.patch("/{conversation_id}", response_model=ConversationRead)
async def update_conversation(
    conversation_id: str, body: ConversationUpdate, session: SessionDep
) -> Conversation:
    conversation = await get_conversation_or_404(session, conversation_id)
    # exclude_unset: a field left out of the request body is left unchanged.
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(conversation, field, value)
    conversation.updated_at = utcnow()
    session.add(conversation)
    await session.commit()
    return conversation


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: str, session: SessionDep) -> Response:
    conversation = await get_conversation_or_404(session, conversation_id)
    # Delete messages explicitly too, so this works even if the database
    # doesn't enforce ON DELETE CASCADE.
    await session.exec(delete(Message).where(col(Message.conversation_id) == conversation_id))
    await session.delete(conversation)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- Streaming --------------------------------------------------------------


async def save_reply(
    sessionmaker: SessionMaker,
    conversation_id: str,
    model: str,
    provider: str,
    content: str,
    status_: MessageStatus,
    error: str | None,
) -> int | None:
    async with sessionmaker() as session:
        message = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=content,
            model=model,
            provider=provider,
            status=status_,
            error=error,
        )
        session.add(message)
        conversation = await session.get(Conversation, conversation_id)
        if conversation is not None:
            conversation.updated_at = utcnow()
            session.add(conversation)
        await session.commit()
        return message.id


@router.post("/{conversation_id}/messages/stream")
async def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    request: Request,
    session: SessionDep,
    registry: RegistryDep,
) -> StreamingResponse:
    conversation = await get_conversation_or_404(session, conversation_id)
    try:
        # The model can change mid-conversation; each request names its provider.
        provider = registry.get(body.provider).provider
    except UnknownProviderError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Provider '{body.provider}' isn't available. Check that it's enabled in Settings.",
        ) from None

    # 1. Save the user's message right away, so it's never lost.
    session.add(Message(conversation_id=conversation_id, role="user", content=body.content))
    if conversation.title == DEFAULT_TITLE:
        conversation.title = title_from_message(body.content)
    conversation.model = body.model
    conversation.provider = body.provider
    conversation.updated_at = utcnow()
    session.add(conversation)
    await session.commit()

    # 2. Build the prompt from the saved history (including the new message).
    prompt = build_prompt(conversation, await get_messages(session, conversation_id))
    sessionmaker: SessionMaker = request.app.state.sessionmaker

    async def event_stream() -> AsyncIterator[str]:
        parts: list[str] = []
        reply_status = MessageStatus.DONE
        error: str | None = None
        message_id: int | None = None
        try:
            async for token in provider.stream_chat(body.model, prompt):
                if await request.is_disconnected():
                    reply_status = MessageStatus.STOPPED
                    logger.info("Client disconnected; stopping generation")
                    return
                parts.append(token)
                yield sse_event("token", {"content": token})
        except ProviderError as exc:
            reply_status, error = MessageStatus.ERROR, str(exc)
        except BaseException:
            # Includes cancellation when the client disconnects mid-write.
            reply_status = MessageStatus.STOPPED
            raise
        finally:
            # 3. Save the reply, even a partial one. Shielded, because this can
            # run while the request is being cancelled, and we still want the
            # write to finish.
            with anyio.CancelScope(shield=True):
                message_id = await save_reply(
                    sessionmaker,
                    conversation_id,
                    body.model,
                    body.provider,
                    "".join(parts),
                    reply_status,
                    error,
                )
        # The final event goes out only after the reply is saved, so a client
        # that reloads the conversation right away always sees it.
        if error is not None:
            yield sse_event("error", {"message": error, "message_id": message_id})
        else:
            yield sse_event("done", {"message_id": message_id})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
