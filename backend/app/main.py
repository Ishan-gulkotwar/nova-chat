"""FastAPI application entry point.

Run locally with:  uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import health
from app.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build and configure the FastAPI app.

    Using a factory (instead of a module-level app only) lets tests create a
    fresh app with custom settings, which becomes important once a database
    is involved.
    """
    settings = settings or get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Every route lives under /api so the frontend can proxy a single prefix.
    app.include_router(health.router, prefix="/api")

    return app


app = create_app()
