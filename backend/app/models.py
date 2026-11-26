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


class ProviderKind(StrEnum):
    OLLAMA = "ollama"  # built in, configured from settings (not stored in the table)
    OPENAI = "openai"  # any OpenAI-compatible API: OpenAI, Groq, OpenRouter...
    ANTHROPIC = "anthropic"


class ProviderConfig(SQLModel, table=True):
    """A cloud LLM provider the admin has configured in Settings."""

    __tablename__ = "provider"

    id: str = Field(default_factory=lambda: uuid4().hex[:12], primary_key=True, max_length=32)
    kind: ProviderKind
    name: str = Field(max_length=100)  # shown in the UI, e.g. "Groq"
    base_url: str = Field(max_length=500)
    # Encrypted with Fernet (see app/security.py); never returned by the API.
    api_key_encrypted: str | None = None
    # Last 4 characters, so the UI can show which key is saved without decrypting it.
    api_key_hint: str | None = Field(default=None, max_length=10)
    enabled: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Conversation(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True, max_length=32)
    title: str = Field(default=DEFAULT_TITLE, max_length=200)
    model: str | None = Field(default=None, max_length=200)  # last model used
    provider: str | None = Field(default=None, max_length=32)  # ...and its provider id
    system_prompt: str = Field(default="", max_length=20_000)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow, index=True)  # sidebar sort key


class Message(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    conversation_id: str = Field(foreign_key="conversation.id", index=True, ondelete="CASCADE")
    role: str = Field(max_length=20)  # "user" | "assistant"
    content: str = ""
    model: str | None = Field(default=None, max_length=200)  # which model wrote it
    provider: str | None = Field(default=None, max_length=32)  # ...via which provider
    status: MessageStatus = MessageStatus.DONE
    error: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
