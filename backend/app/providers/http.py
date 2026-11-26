"""Shared HTTP helpers for provider adapters."""

import json

import httpx

from app.providers.base import ProviderError


def error_detail(body: str) -> str:
    """Extract a readable message from a provider's JSON error body.

    Handles the common shapes: {"error": "..."}, {"error": {"message": "..."}},
    {"message": "..."}, {"detail": "..."}.
    """
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return body.strip()[:300] or "no details"
    # Unwrap nested {"error": {...}} / {"detail": {...}} until we reach a message.
    for _ in range(3):
        if not isinstance(data, dict):
            break
        nested = data.get("error") or data.get("detail")
        if isinstance(data.get("message"), str):
            return str(data["message"])[:300]
        if nested is None:
            break
        data = nested
    return str(data)[:300]


async def raise_for_status(response: httpx.Response, provider_name: str) -> None:
    """Turn a non-2xx response into a ProviderError with a helpful message."""
    if response.is_success:
        return
    body = (await response.aread()).decode(errors="replace")
    detail = error_detail(body)
    if response.status_code in (401, 403):
        raise ProviderError(f"{provider_name} rejected the API key ({response.status_code}): {detail}")
    if response.status_code == 429:
        raise ProviderError(f"{provider_name} rate limit reached. Try again shortly. ({detail})")
    raise ProviderError(f"{provider_name} error ({response.status_code}): {detail}")


def transport_error(exc: httpx.HTTPError, provider_name: str, base_url: str) -> ProviderError:
    if isinstance(exc, httpx.ConnectError):
        return ProviderError(f"Could not connect to {provider_name} at {base_url}.")
    if isinstance(exc, httpx.TimeoutException):
        return ProviderError(f"{provider_name} took too long to respond.")
    return ProviderError(f"{provider_name} request failed: {exc}")
