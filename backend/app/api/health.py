"""System endpoints: a liveness check and a hello-world used by the frontend."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app import __version__
from app.config import Settings, get_settings

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


class HelloResponse(BaseModel):
    message: str
    environment: str


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe for Docker, the hosting platform, and the frontend."""
    return HealthResponse(status="ok", version=__version__)


@router.get("/hello", response_model=HelloResponse)
def hello(
    settings: Annotated[Settings, Depends(get_settings)],
    name: Annotated[str, Query(min_length=1, max_length=50)] = "world",
) -> HelloResponse:
    """Greet the caller. Proves the frontend <-> backend round trip works."""
    return HelloResponse(
        message=f"Hello, {name}! This is {settings.app_name}.",
        environment=settings.environment,
    )
