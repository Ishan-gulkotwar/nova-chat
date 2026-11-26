"""Application settings, loaded from environment variables and an optional .env file.

All configuration lives here so every setting is typed, validated at startup,
and documented in one place. Import `get_settings()` rather than instantiating
`Settings` directly, so the same cached instance is shared across the app.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed application configuration.

    Each field maps to an environment variable of the same name
    (case-insensitive), e.g. `app_name` <- `APP_NAME`.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # ignore unrelated variables in .env
    )

    app_name: str = "Nova Chat"
    environment: Literal["development", "test", "production"] = "development"

    # Origins allowed to call the API from a browser. In development the Vite
    # proxy makes requests same-origin, but production (Vercel frontend ->
    # separately hosted backend) needs CORS. In .env, write it as a JSON list:
    # CORS_ORIGINS=["http://localhost:5173","https://nova-chat.vercel.app"]
    cors_origins: list[str] = ["http://localhost:5173"]

    # --- LLM providers -------------------------------------------------------
    # Where the Ollama server listens. Inside Docker (Phase 8) this becomes
    # http://ollama:11434 or http://host.docker.internal:11434.
    ollama_base_url: str = "http://localhost:11434"
    # Seconds to wait for the model to produce the next chunk. Generous because
    # a local model's first token can be slow while it loads into memory.
    llm_timeout_seconds: float = 120.0


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (read the environment once per process)."""
    return Settings()
