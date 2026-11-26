/**
 * Typed HTTP client for the Nova Chat backend.
 *
 * Every backend call goes through `request()` or `streamChat()`, so error
 * handling, the base URL and (in Phase 5) auth headers live in one place.
 */

import { readSSE } from './sse.ts'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

/** Thrown for any non-2xx response or a stream `error` event. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Pull FastAPI's `{"detail": "..."}` message out of an error response, if there is one. */
async function errorFromResponse(response: Response): Promise<ApiError> {
  let message = `Request failed: ${response.status} ${response.statusText}`
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
      message = body.detail
    }
  } catch {
    // Body wasn't JSON; keep the generic message.
  }
  return new ApiError(response.status, message)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  })
  if (!response.ok) throw await errorFromResponse(response)
  return (await response.json()) as T
}

// ---- Types (mirror the Pydantic models in backend/app) ----

export interface HealthResponse {
  status: 'ok'
  version: string
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  size_bytes: number | null
}

export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: Role
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
}

// ---- Endpoints ----

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  models: () => request<ModelInfo[]>('/api/models'),
}

/**
 * Stream an assistant reply. Calls `onToken` for each chunk as it arrives and
 * resolves when the server sends `done`.
 *
 * Pass an AbortSignal to support a Stop button: aborting closes the HTTP
 * connection, the backend notices, and generation stops. An aborted stream
 * rejects with a DOMException named "AbortError".
 */
export async function streamChat(
  body: ChatRequest,
  { onToken, signal }: { onToken: (text: string) => void; signal?: AbortSignal },
): Promise<void> {
  // EventSource only supports GET, so we POST with fetch and parse the SSE stream ourselves.
  const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw await errorFromResponse(response)
  if (!response.body) throw new ApiError(500, 'Response has no body to stream')

  for await (const event of readSSE(response.body)) {
    const data = JSON.parse(event.data) as Record<string, unknown>
    if (event.event === 'token') onToken(String(data.content ?? ''))
    else if (event.event === 'error') throw new ApiError(502, String(data.message ?? 'Unknown error'))
    else if (event.event === 'done') return
  }
  // The stream ended without `done`: the connection dropped mid-reply.
  throw new ApiError(502, 'The connection closed before the reply finished.')
}
