"""System endpoints."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app import __version__

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe for Docker, the hosting platform, and the frontend."""
    return HealthResponse(status="ok", version=__version__)
