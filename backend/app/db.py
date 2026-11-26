"""Database engine, session factory and FastAPI session dependency.

We use SQLAlchemy's async engine (through SQLModel), so database calls never
block the event loop. That matters here: one slow query must not stall every
other user's streaming reply.
"""

from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

SessionMaker = async_sessionmaker[AsyncSession]


def create_engine(database_url: str, echo: bool = False) -> AsyncEngine:
    engine = create_async_engine(database_url, echo=echo)

    if engine.dialect.name == "sqlite":
        # SQLite ignores foreign keys unless asked, per connection.
        @event.listens_for(engine.sync_engine, "connect")
        def _enable_sqlite_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def create_sessionmaker(engine: AsyncEngine) -> SessionMaker:
    # expire_on_commit=False: objects stay usable after commit (no surprise
    # lazy reloads, which async sessions can't do implicitly).
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db(engine: AsyncEngine) -> None:
    """Create any missing tables.

    Good enough while the schema is evolving locally. Phase 8 replaces this with
    Alembic migrations, which can also *change* existing tables safely.
    """
    import app.models  # noqa: F401  (registers the tables on SQLModel.metadata)

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, closed afterwards."""
    sessionmaker: SessionMaker = request.app.state.sessionmaker
    async with sessionmaker() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
