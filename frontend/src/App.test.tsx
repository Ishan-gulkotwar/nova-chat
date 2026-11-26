import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'
import { FakeBackend } from './test/fakeBackend.ts'

let backend: FakeBackend

/** Renders the current URL so tests can assert on navigation. */
function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>
}

function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // StrictMode, like main.tsx: React mounts components twice in development, which
  // catches effects that aren't safe to run twice (e.g. sending a message twice).
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

const sidebar = () => screen.getByRole('navigation', { name: 'Chats' })
const modelsLoaded = () => screen.findByRole('option', { name: 'llama3.2' })

describe('App', () => {
  beforeEach(() => {
    backend = new FakeBackend()
    backend.install()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates a chat on the first message, streams the reply and lists it in the sidebar', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await modelsLoaded()

    await user.type(screen.getByLabelText('Message'), 'Hi there{Enter}')

    // Rendered as Markdown: **world** becomes <strong>.
    expect(await screen.findByText('world')).toContainHTML('strong')
    const [id] = backend.conversations.keys()
    expect(screen.getByTestId('location')).toHaveTextContent(`/c/${id}`)
    expect(await within(sidebar()).findByRole('link', { name: 'Hi there' })).toHaveAttribute('href', `/c/${id}`)
    // The header shows the auto-generated title once the reply is done.
    expect(await screen.findByRole('heading', { name: 'Hi there' })).toBeInTheDocument()
    const streams = backend.requests.filter((r) => r.path.endsWith('/messages/stream'))
    expect(streams).toHaveLength(1) // sent exactly once, even in StrictMode
    expect(streams[0].body).toEqual({ content: 'Hi there', model: 'llama3.2:latest', provider: 'ollama' })
  })

  it('loads a saved chat from its URL', async () => {
    const id = backend.add('Old chat', [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: 'It is 4.' },
    ])
    renderApp(`/c/${id}`)

    expect(await screen.findByText('It is 4.')).toBeInTheDocument()
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Old chat' })).toBeInTheDocument()
  })

  it('stops generation and keeps the partial reply', async () => {
    const id = backend.add('Story')
    backend.streamPlan = { chunks: ['Once upon'], keepOpen: true }
    const user = userEvent.setup()
    renderApp(`/c/${id}`)
    await modelsLoaded()

    await user.type(screen.getByLabelText('Message'), 'Tell me a story{Enter}')
    expect(await screen.findByText('Once upon')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText('Once upon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('shows a provider error from the stream', async () => {
    const id = backend.add('Errors')
    backend.streamPlan = { chunks: [], error: "model 'x' not found" }
    const user = userEvent.setup()
    renderApp(`/c/${id}`)
    await modelsLoaded()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent("model 'x' not found")
  })

  it('renames a chat from the sidebar', async () => {
    backend.add('Untitled idea')
    const user = userEvent.setup()
    renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'Rename Untitled idea' }))
    const input = screen.getByLabelText('Chat title')
    await user.clear(input)
    await user.type(input, 'Startup idea{Enter}')

    expect(await within(sidebar()).findByRole('link', { name: 'Startup idea' })).toBeInTheDocument()
    expect([...backend.conversations.values()][0].title).toBe('Startup idea')
  })

  it('deletes the open chat after confirming and returns to a new chat', async () => {
    const id = backend.add('Delete me', [{ role: 'user', content: 'bye' }])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderApp(`/c/${id}`)

    await user.click(await screen.findByRole('button', { name: 'Delete Delete me' }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/))
    expect(await within(sidebar()).findByText('No chats yet.')).toBeInTheDocument()
    expect(backend.conversations.size).toBe(0)
  })

  it('searches chats by title and message text', async () => {
    backend.add('Python tips')
    backend.add('Baking', [{ role: 'user', content: 'sourdough starter' }])
    const user = userEvent.setup()
    renderApp('/')
    await within(sidebar()).findByRole('link', { name: 'Python tips' })

    await user.type(screen.getByLabelText('Search chats'), 'sourdough')

    await waitFor(() =>
      expect(within(sidebar()).queryByRole('link', { name: 'Python tips' })).not.toBeInTheDocument(),
    )
    expect(within(sidebar()).getByRole('link', { name: 'Baking' })).toBeInTheDocument()
  })

  it('saves a system prompt with a new chat', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await modelsLoaded()

    await user.click(screen.getByRole('button', { name: 'System prompt' }))
    await user.type(screen.getByLabelText('System prompt'), 'Answer like a pirate.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.type(screen.getByLabelText('Message'), 'Hello{Enter}')

    await screen.findByText('world')
    expect(backend.requests.find((r) => r.method === 'POST' && r.path === '/api/conversations')?.body).toEqual({
      model: 'llama3.2:latest',
      provider: 'ollama',
      system_prompt: 'Answer like a pirate.',
    })
  })

  it('switches models mid-chat and labels each reply with its model', async () => {
    const id = backend.add('Compare')
    const user = userEvent.setup()
    renderApp(`/c/${id}`)
    await modelsLoaded()

    // The dropdown groups models by provider.
    expect(screen.getByRole('group', { name: 'Groq' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Message'), 'First{Enter}')
    await screen.findByText('world')
    await user.selectOptions(screen.getByLabelText('Model'), 'groq1::llama-3.3-70b')
    await user.type(screen.getByLabelText('Message'), 'Second{Enter}')

    await waitFor(() => expect(screen.getAllByText('world')).toHaveLength(2))
    const streams = backend.requests.filter((r) => r.path.endsWith('/messages/stream'))
    expect(streams.map((r) => r.body)).toEqual([
      { content: 'First', model: 'llama3.2:latest', provider: 'ollama' },
      { content: 'Second', model: 'llama-3.3-70b', provider: 'groq1' },
    ])
    // Each reply is labelled with the model that wrote it.
    expect(await screen.findByTitle('Answered by llama3.2:latest')).toHaveTextContent('llama3.2')
    expect(screen.getByTitle('Answered by llama-3.3-70b')).toBeInTheDocument()
  })

  it('warns about a provider that is down but keeps the others usable', async () => {
    backend.modelsResponse.errors = [
      { provider: 'ollama', provider_name: 'Ollama', message: 'Could not connect to Ollama. Is Ollama running?' },
    ]
    renderApp('/')

    expect(await screen.findByText(/Is Ollama running\?/)).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeEnabled()
  })

  it('shows a friendly page for a chat that does not exist', async () => {
    renderApp('/c/missing')
    expect(await screen.findByText(/doesn't exist/)).toBeInTheDocument()
  })
})
