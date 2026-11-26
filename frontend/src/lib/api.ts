/**
 * Typed HTTP client for the Nova Chat backend.
 *
 * Every backend call goes through `request()` or `streamMessage()`, so error
 * handling, the base URL and (in Phase 5) auth headers live in one place.
 */

import { readSSE } from './sse.ts'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

/** Thrown for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Thrown when a reply fails *after* streaming started (an `error` event, or the
 * connection dropping). By then the server has saved the user's message.
 */
export class StreamError extends ApiError {
  constructor(message: string) {
    super(502, message)
    this.name = 'StreamError'
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
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) throw await errorFromResponse(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

// ---- Types (mirror backend/app/schemas.py) ----

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
export type MessageStatus = 'done' | 'stopped' | 'error'

export interface Conversation {
  id: string
  title: string
  model: string | null
  system_prompt: string
  created_at: string
  updated_at: string
}

export interface StoredMessage {
  id: number
  role: Role
  content: string
  model: string | null
  status: MessageStatus
  error: string | null
  created_at: string
}

export interface ConversationDetail extends Conversation {
  messages: StoredMessage[]
}

export interface ConversationCreate {
  title?: string
  model?: string
  system_prompt?: string
}

export type ConversationUpdate = Partial<Pick<Conversation, 'title' | 'model' | 'system_prompt'>>

// ---- Endpoints ----

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  models: () => request<ModelInfo[]>('/api/models'),

  conversations: {
    list: (q?: string) =>
      request<Conversation[]>(`/api/conversations${q ? `?${new URLSearchParams({ q })}` : ''}`),
    get: (id: string) => request<ConversationDetail>(`/api/conversations/${id}`),
    create: (body: ConversationCreate) =>
      request<Conversation>('/api/conversations', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: ConversationUpdate) =>
      request<Conversation>(`/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<void>(`/api/conversations/${id}`, { method: 'DELETE' }),
  },
}

/**
 * Send a message to a conversation and stream the reply. Calls `onToken` for
 * each chunk and resolves when the server sends `done`.
 *
 * Pass an AbortSignal to support a Stop button: aborting closes the HTTP
 * connection, the backend notices, saves the partial reply and stops the model.
 * An aborted stream rejects with a DOMException named "AbortError".
 */
export async function streamMessage(
  conversationId: string,
  body: { content: string; model: string },
  { onToken, signal }: { onToken: (text: string) => void; signal?: AbortSignal },
): Promise<void> {
  // EventSource only supports GET, so we POST with fetch and parse the SSE stream ourselves.
  const response = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/messages/stream`, {
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
    else if (event.event === 'error') throw new StreamError(String(data.message ?? 'Unknown error'))
    else if (event.event === 'done') return
  }
  // The stream ended without `done`: the connection dropped mid-reply.
  throw new StreamError('The connection closed before the reply finished.')
}
