"""Server-Sent Events formatting for our streaming endpoints."""

import json
from typing import Any


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Format one Server-Sent Event. JSON has no raw newlines, so one data line is enough."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
