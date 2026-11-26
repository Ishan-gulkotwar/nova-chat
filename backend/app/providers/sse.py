"""Parse a Server-Sent Events stream from an httpx response.

OpenAI-compatible APIs and Anthropic both stream with SSE, just like our own
API does towards the browser.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx


@dataclass
class SSEEvent:
    event: str
    data: str


async def iter_sse(response: httpx.Response) -> AsyncIterator[SSEEvent]:
    event, data_lines = "message", []
    async for line in response.aiter_lines():
        if line == "":  # a blank line ends the event
            if data_lines:
                yield SSEEvent(event, "\n".join(data_lines))
            event, data_lines = "message", []
            continue
        if line.startswith(":"):  # comment / keep-alive
            continue
        field, _, value = line.partition(":")
        value = value.removeprefix(" ")
        if field == "event":
            event = value
        elif field == "data":
            data_lines.append(value)
    if data_lines:
        yield SSEEvent(event, "\n".join(data_lines))
