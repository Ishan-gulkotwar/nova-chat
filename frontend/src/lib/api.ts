/**
 * Minimal typed HTTP client for the Nova Chat backend.
 *
 * Every backend call goes through `request()`, so error handling, base URL
 * and (later) auth headers live in exactly one place.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

/** Thrown for any non-2xx response, carrying the HTTP status. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

// Response types mirror the Pydantic models in backend/app/api/health.py.
export interface HealthResponse {
  status: 'ok'
  version: string
}

export interface HelloResponse {
  message: string
  environment: string
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  hello: (name: string) =>
    request<HelloResponse>(`/api/hello?${new URLSearchParams({ name }).toString()}`),
}
