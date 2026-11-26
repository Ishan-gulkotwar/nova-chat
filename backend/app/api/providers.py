"""Providers and models.

    GET    /api/models                   every model from every enabled provider (+ per-provider errors)
    GET    /api/providers                built-in Ollama + configured providers (never the API keys)
    POST   /api/providers                add a provider (API key is encrypted before it's stored)
    PATCH  /api/providers/{id}           rename, change URL, replace/remove key, enable/disable
    DELETE /api/providers/{id}
    POST   /api/providers/{id}/test      try listing its models with the saved settings

Phase 5 restricts the /providers routes to admins.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlmodel import col, select

from app.config import Settings
from app.db import SessionDep
from app.models import ProviderConfig, ProviderKind, utcnow
from app.providers import ProviderError
from app.providers.registry import (
    OLLAMA_ID,
    OLLAMA_NAME,
    ProviderRegistry,
    build_provider,
    load_registry,
)
from app.schemas import (
    ModelsResponse,
    ProviderCreate,
    ProviderIssue,
    ProviderRead,
    ProviderTestResult,
    ProviderUpdate,
)
from app.security import DecryptionError, Encryptor, mask_secret

router = APIRouter(tags=["providers"])

def get_encryptor(request: Request) -> Encryptor:
    encryptor: Encryptor = request.app.state.encryptor
    return encryptor


EncryptorDep = Annotated[Encryptor, Depends(get_encryptor)]


async def get_registry(session: SessionDep, request: Request, encryptor: EncryptorDep) -> ProviderRegistry:
    """Dependency: the providers available for this request. Tests override it with fakes."""
    settings: Settings = request.app.state.settings
    return await load_registry(session, settings, encryptor)


RegistryDep = Annotated[ProviderRegistry, Depends(get_registry)]


def to_read(config: ProviderConfig) -> ProviderRead:
    return ProviderRead(
        id=config.id,
        kind=config.kind,
        name=config.name,
        base_url=config.base_url,
        enabled=config.enabled,
        has_api_key=config.api_key_encrypted is not None,
        api_key_hint=config.api_key_hint,
    )


def ollama_read(settings: Settings) -> ProviderRead:
    return ProviderRead(
        id=OLLAMA_ID,
        kind=ProviderKind.OLLAMA,
        name=OLLAMA_NAME,
        base_url=settings.ollama_base_url,
        enabled=settings.ollama_enabled,
        has_api_key=False,
        api_key_hint=None,
        builtin=True,
    )


def set_api_key(config: ProviderConfig, api_key: str | None, encryptor: Encryptor) -> None:
    api_key = (api_key or "").strip()
    config.api_key_encrypted = encryptor.encrypt(api_key) if api_key else None
    config.api_key_hint = mask_secret(api_key) if api_key else None


async def get_config_or_404(session: SessionDep, provider_id: str) -> ProviderConfig:
    if provider_id == OLLAMA_ID:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Ollama is built in; configure it with OLLAMA_* settings."
        )
    config = await session.get(ProviderConfig, provider_id)
    if config is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found")
    return config


# ---- Models -----------------------------------------------------------------


@router.get("/models", response_model=ModelsResponse)
async def list_models(registry: RegistryDep) -> ModelsResponse:
    models, errors = await registry.list_models()
    return ModelsResponse(
        models=models,
        errors=[ProviderIssue(provider=e.id, provider_name=e.name, message=msg) for e, msg in errors],
    )


# ---- Provider CRUD -----------------------------------------------------------


@router.get("/providers", response_model=list[ProviderRead])
async def list_providers(session: SessionDep, request: Request) -> list[ProviderRead]:
    settings: Settings = request.app.state.settings
    rows = await session.exec(select(ProviderConfig).order_by(col(ProviderConfig.created_at)))
    return [ollama_read(settings), *(to_read(c) for c in rows.all())]


@router.post("/providers", response_model=ProviderRead, status_code=status.HTTP_201_CREATED)
async def create_provider(body: ProviderCreate, session: SessionDep, encryptor: EncryptorDep) -> ProviderRead:
    if body.kind == ProviderKind.OLLAMA:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ollama is built in and can't be added again.")
    if body.kind == ProviderKind.ANTHROPIC and not body.api_key:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Anthropic requires an API key.")
    config = ProviderConfig(kind=body.kind, name=body.name.strip(), base_url=str(body.base_url).rstrip("/"))
    set_api_key(config, body.api_key.get_secret_value() if body.api_key else None, encryptor)
    session.add(config)
    await session.commit()
    return to_read(config)


@router.patch("/providers/{provider_id}", response_model=ProviderRead)
async def update_provider(
    provider_id: str, body: ProviderUpdate, session: SessionDep, encryptor: EncryptorDep
) -> ProviderRead:
    config = await get_config_or_404(session, provider_id)
    changes = body.model_dump(exclude_unset=True)
    if body.name is not None:
        config.name = body.name.strip()
    if body.base_url is not None:
        config.base_url = str(body.base_url).rstrip("/")
    if body.enabled is not None:
        config.enabled = body.enabled
    if "api_key" in changes:
        set_api_key(config, body.api_key.get_secret_value() if body.api_key else None, encryptor)
    config.updated_at = utcnow()
    session.add(config)
    await session.commit()
    return to_read(config)


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(provider_id: str, session: SessionDep) -> Response:
    config = await get_config_or_404(session, provider_id)
    await session.delete(config)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/providers/{provider_id}/test", response_model=ProviderTestResult)
async def test_provider(
    provider_id: str, session: SessionDep, encryptor: EncryptorDep, request: Request
) -> ProviderTestResult:
    """Check the saved URL and key by listing models (works even if the provider is disabled)."""
    settings: Settings = request.app.state.settings
    if provider_id == OLLAMA_ID:
        always_on = settings.model_copy(update={"ollama_enabled": True})
        registry = await load_registry(session, always_on, encryptor)
        provider = registry.get(OLLAMA_ID).provider
    else:
        config = await get_config_or_404(session, provider_id)
        try:
            api_key = encryptor.decrypt(config.api_key_encrypted) if config.api_key_encrypted else None
        except DecryptionError as exc:
            return ProviderTestResult(ok=False, error=str(exc))
        provider = build_provider(config, api_key, settings)
    try:
        models = await provider.list_models()
    except ProviderError as exc:
        return ProviderTestResult(ok=False, error=str(exc))
    return ProviderTestResult(ok=True, model_count=len(models))
