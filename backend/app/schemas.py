"""Request/response shapes for the conversations API.

Kept separate from the table models so the API contract can't accidentally
expose (or accept) database-only fields.
"""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, HttpUrl, SecretStr

from app.models import MessageStatus, ProviderKind
from app.providers import ModelInfo


def _as_utc(value: datetime) -> datetime:
    # SQLite stores datetimes without a timezone; they are UTC by construction.
    return value if value.tzinfo else value.replace(tzinfo=UTC)


UTCDatetime = Annotated[datetime, AfterValidator(_as_utc)]

Title = Annotated[str, Field(min_length=1, max_length=200)]
SystemPrompt = Annotated[str, Field(max_length=20_000)]


ModelId = Annotated[str, Field(min_length=1, max_length=200)]
ProviderId = Annotated[str, Field(min_length=1, max_length=32)]


class ConversationCreate(BaseModel):
    title: Title | None = None
    model: ModelId | None = None
    provider: ProviderId | None = None
    system_prompt: SystemPrompt = ""


class ConversationUpdate(BaseModel):
    """PATCH body: only the fields that are sent get changed."""

    title: Title | None = None
    model: ModelId | None = None
    provider: ProviderId | None = None
    system_prompt: SystemPrompt | None = None


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    model: str | None
    provider: str | None
    system_prompt: str
    created_at: UTCDatetime
    updated_at: UTCDatetime


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    model: str | None
    provider: str | None
    status: MessageStatus
    error: str | None
    created_at: UTCDatetime


class ConversationDetail(ConversationRead):
    messages: list[MessageRead]


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)
    model: ModelId
    provider: ProviderId


# ---- Providers ----------------------------------------------------------------

ProviderName = Annotated[str, Field(min_length=1, max_length=100)]


class ProviderCreate(BaseModel):
    kind: ProviderKind
    name: ProviderName
    base_url: HttpUrl
    # SecretStr: never echoed in logs, reprs or validation errors.
    api_key: SecretStr | None = None


class ProviderUpdate(BaseModel):
    """PATCH body. Send `api_key: ""` to remove the saved key."""

    name: ProviderName | None = None
    base_url: HttpUrl | None = None
    api_key: SecretStr | None = None
    enabled: bool | None = None


class ProviderRead(BaseModel):
    """What the API reveals about a provider. Note: no API key, only a hint."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: ProviderKind
    name: str
    base_url: str
    enabled: bool
    has_api_key: bool
    api_key_hint: str | None
    builtin: bool = False  # Ollama: configured via settings, can't be edited here


class ProviderTestResult(BaseModel):
    ok: bool
    model_count: int = 0
    error: str | None = None


class ProviderIssue(BaseModel):
    provider: str
    provider_name: str
    message: str


class ModelsResponse(BaseModel):
    """All models from every enabled provider, plus the providers that failed to answer."""

    models: list[ModelInfo]
    errors: list[ProviderIssue]
