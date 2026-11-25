import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'

/** Render App with a fresh, non-retrying query client per test. */
function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

/** Fake fetch that answers like the real backend. */
function mockBackend() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString()
    const body = url.includes('/api/health')
      ? { status: 'ok', version: '0.1.0' }
      : { message: 'Hello, world! This is Nova Chat.', environment: 'test' }
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the backend as connected and renders the greeting', async () => {
    mockBackend()
    renderApp()

    expect(await screen.findByText('Backend connected (v0.1.0)')).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('Hello, world!')
  })

  it('shows an error when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    renderApp()

    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Say hi' })).toBeDisabled()
  })
})
