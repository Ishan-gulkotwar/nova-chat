"""Database tables.

A Conversation has many Messages. Conversation ids are random UUID hex strings
(they appear in URLs, so they shouldn't be guessable or reveal how many chats
exist); message ids are auto-increment integers that also give a stable order.
"""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from sqlmodel import Field, SQLModel

DEFAULT_TITLE = "New chat"


def utcnow() -> datetime:
    return datetime.now(UTC)


class MessageStatus(StrEnum):
    DONE = "done"  # reply completed normally
    STOPPED = "stopped"  # user pressed Stop; content is partial
    ERROR = "error"  # provider failed; content may be partial


class Conversation(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True, max_length=32)
    title: str = Field(default=DEFAULT_TITLE, max_length=200)
    model: str | None = Field(default=None, max_length=200)  # last model used
    system_prompt: str = Field(default="", max_length=20_000)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow, index=True)  # sidebar sort key


class Message(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    conversation_id: str = Field(foreign_key="conversation.id", index=True, ondelete="CASCADE")
    role: str = Field(max_length=20)  # "user" | "assistant"
    content: str = ""
    model: str | None = Field(default=None, max_length=200)  # which model wrote it
    status: MessageStatus = MessageStatus.DONE
    error: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
