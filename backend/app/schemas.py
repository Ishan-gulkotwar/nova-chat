"""Request/response shapes for the conversations API.

Kept separate from the table models so the API contract can't accidentally
expose (or accept) database-only fields.
"""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.models import MessageStatus


def _as_utc(value: datetime) -> datetime:
    # SQLite stores datetimes without a timezone; they are UTC by construction.
    return value if value.tzinfo else value.replace(tzinfo=UTC)


UTCDatetime = Annotated[datetime, AfterValidator(_as_utc)]

Title = Annotated[str, Field(min_length=1, max_length=200)]
SystemPrompt = Annotated[str, Field(max_length=20_000)]


class ConversationCreate(BaseModel):
    title: Title | None = None
    model: str | None = Field(default=None, max_length=200)
    system_prompt: SystemPrompt = ""


class ConversationUpdate(BaseModel):
    """PATCH body: only the fields that are sent get changed."""

    title: Title | None = None
    model: str | None = Field(default=None, max_length=200)
    system_prompt: SystemPrompt | None = None


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    model: str | None
    system_prompt: str
    created_at: UTCDatetime
    updated_at: UTCDatetime


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    model: str | None
    status: MessageStatus
    error: str | None
    created_at: UTCDatetime


class ConversationDetail(ConversationRead):
    messages: list[MessageRead]


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)
    model: str = Field(min_length=1, max_length=200)
