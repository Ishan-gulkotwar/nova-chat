"""FastAPI application entry point.

Run locally with:  python -m uvicorn app.main:app --reload
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import chat, conversations, health
from app.config import Settings, get_settings
from app.db import create_engine, create_sessionmaker, init_db


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build and configure the FastAPI app.

    Using a factory lets tests create a fresh app with their own settings,
    e.g. a throwaway database per test.
    """
    settings = settings or get_settings()
    engine = create_engine(settings.database_url, echo=settings.database_echo)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        # Runs once at startup (before the first request) and once at shutdown.
        await init_db(engine)
        yield
        await engine.dispose()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = create_sessionmaker(engine)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Every route lives under /api so the frontend can proxy a single prefix.
    app.include_router(health.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(conversations.router, prefix="/api")

    return app


app = create_app()
