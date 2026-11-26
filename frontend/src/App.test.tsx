import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

const encoder = new TextEncoder()

/** An SSE response that sends the given events, then (optionally) stays open until aborted. */
function sseResponse(events: string[], { keepOpen = false, signal }: { keepOpen?: boolean; signal?: AbortSignal } = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e))
      if (!keepOpen) controller.close()
      // Like a real browser: aborting the request errors the body stream.
      signal?.addEventListener('abort', () =>
        controller.error(new DOMException('The operation was aborted.', 'AbortError')),
      )
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const token = (content: string) => `event: token\ndata: ${JSON.stringify({ content })}\n\n`
const DONE = 'event: done\ndata: {}\n\n'

/** Fake backend. `chat` decides how /api/chat/stream answers. */
function mockBackend(chat: (init: RequestInit) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input.toString()
    if (url.endsWith('/api/health')) return Response.json({ status: 'ok', version: '0.2.0' })
    if (url.endsWith('/api/models'))
      return Response.json([{ id: 'llama3.2:latest', name: 'llama3.2', provider: 'ollama', size_bytes: 1 }])
    if (url.endsWith('/api/chat/stream')) return chat(init)
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('streams an assistant reply rendered as Markdown', async () => {
    const fetchMock = mockBackend(() => sseResponse([token('Hello, '), token('**world**'), DONE]))
    const user = userEvent.setup()
    renderApp()

    // The first model is selected automatically once models load.
    expect(await screen.findByRole('option', { name: 'llama3.2 · ollama' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Message'), 'Hi there{Enter}')

    const reply = await screen.findByTestId('assistant-message')
    expect(await within(reply).findByText('world')).toContainHTML('strong')
    expect(screen.getByText('Hi there')).toBeInTheDocument()

    const [, init] = fetchMock.mock.calls.find(([url]) => url.toString().endsWith('/api/chat/stream'))!
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'llama3.2:latest',
      messages: [{ role: 'user', content: 'Hi there' }],
    })
  })

  it('stops generation when Stop is clicked', async () => {
    mockBackend((init) => sseResponse([token('Partial answer')], { keepOpen: true, signal: init.signal ?? undefined }))
    const user = userEvent.setup()
    renderApp()

    await screen.findByRole('option', { name: 'llama3.2 · ollama' })
    await user.type(screen.getByLabelText('Message'), 'Tell me a story{Enter}')

    expect(await screen.findByText('Partial answer')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('Stopped')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByText('Partial answer')).toBeInTheDocument() // partial text is kept
  })

  it('shows a provider error from the stream', async () => {
    mockBackend(() =>
      sseResponse([`event: error\ndata: ${JSON.stringify({ message: "model 'x' not found" })}\n\n`]),
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByRole('option', { name: 'llama3.2 · ollama' })
    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent("model 'x' not found")
  })

  it('shows a banner when models cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        input.toString().endsWith('/api/models')
          ? Response.json({ detail: 'Could not connect to Ollama. Is Ollama running?' }, { status: 502 })
          : Response.json({ status: 'ok', version: '0.2.0' }),
      ),
    )
    renderApp()

    expect(await screen.findByRole('alert')).toHaveTextContent('Is Ollama running?')
    expect(screen.getByLabelText('Message')).toBeDisabled()
  })
})
