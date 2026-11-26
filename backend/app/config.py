"""Application settings, loaded from environment variables and an optional .env file.

All configuration lives here so every setting is typed, validated at startup,
and documented in one place. Import `get_settings()` rather than instantiating
`Settings` directly, so the same cached instance is shared across the app.
"""

from functools import lru_cache
from typing import Literal, Self

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEV_SECRET = "dev-insecure-secret-change-me"


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

    # --- Security --------------------------------------------------------------
    # Master secret. The key that encrypts stored API keys is derived from it
    # (and in Phase 5, the key that signs login tokens). Changing it makes saved
    # API keys unreadable, so they'd have to be re-entered.
    # Generate one with:  python -c "import secrets; print(secrets.token_urlsafe(32))"
    # SecretStr keeps it out of logs and error messages.
    secret_key: SecretStr = SecretStr(INSECURE_DEV_SECRET)

    # --- Database --------------------------------------------------------------
    # SQLAlchemy async URL. SQLite file for local dev; Postgres in Docker/production
    # (Phase 8), e.g. postgresql+asyncpg://user:pass@host:5432/nova_chat
    database_url: str = "sqlite+aiosqlite:///./nova_chat.db"
    # Log every SQL statement (useful while learning, noisy otherwise).
    database_echo: bool = False

    # --- LLM providers -------------------------------------------------------
    # Ollama is built in (no API key). Turn it off where there's no Ollama server,
    # e.g. a cloud deployment that only uses Groq.
    ollama_enabled: bool = True
    # Where the Ollama server listens. Inside Docker (Phase 8) this becomes
    # http://ollama:11434 or http://host.docker.internal:11434.
    ollama_base_url: str = "http://localhost:11434"
    # Seconds to wait for the model to produce the next chunk. Generous because
    # a local model's first token can be slow while it loads into memory.
    llm_timeout_seconds: float = 120.0
    # Upper bound on reply length for providers that require one (Anthropic).
    llm_max_output_tokens: int = 4096

    @model_validator(mode="after")
    def _require_real_secret_in_production(self) -> Self:
        if self.environment == "production" and (
            self.secret_key.get_secret_value() == INSECURE_DEV_SECRET
            or len(self.secret_key.get_secret_value()) < 32
        ):
            raise ValueError("Set SECRET_KEY to a random value of at least 32 characters in production.")
        return self


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (read the environment once per process)."""
    return Settings()
