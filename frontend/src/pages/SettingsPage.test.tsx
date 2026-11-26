import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App.tsx'
import { FakeBackend } from '../test/fakeBackend.ts'

let backend: FakeBackend

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const card = (name: string) => screen.findByRole('listitem', { name })

describe('Settings page', () => {
  beforeEach(() => {
    backend = new FakeBackend()
    backend.install()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows built-in Ollama, which can be tested but not deleted', async () => {
    const user = userEvent.setup()
    renderSettings()

    const ollama = await card('Ollama')
    expect(within(ollama).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
    await user.click(within(ollama).getByRole('button', { name: 'Test' }))
    expect(await within(ollama).findByRole('status')).toHaveTextContent('Connected · 3 models')
  })

  it('adds Groq from a preset; the key is sent once and only its hint is shown afterwards', async () => {
    const user = userEvent.setup()
    renderSettings()
    const form = await screen.findByRole('form', { name: 'Add provider' })

    // The Groq preset fills in the name and URL.
    expect(within(form).getByLabelText('Display name')).toHaveValue('Groq')
    expect(within(form).getByLabelText('Base URL')).toHaveValue('https://api.groq.com/openai/v1')
    const addButton = within(form).getByRole('button', { name: 'Add provider' })
    expect(addButton).toBeDisabled() // key required

    await user.type(within(form).getByLabelText(/API key/), 'gsk_secret_value_7777')
    await user.click(addButton)

    const groq = await card('Groq')
    expect(within(groq).getByText('Saved (…7777)')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('gsk_secret_value_7777')).not.toBeInTheDocument() // field cleared
    expect(backend.requests.find((r) => r.method === 'POST' && r.path === '/api/providers')?.body).toEqual({
      kind: 'openai',
      name: 'Groq',
      base_url: 'https://api.groq.com/openai/v1',
      api_key: 'gsk_secret_value_7777',
    })
  })

  it('switching preset to Anthropic fills its URL', async () => {
    const user = userEvent.setup()
    renderSettings()
    const form = await screen.findByRole('form', { name: 'Add provider' })

    await user.selectOptions(within(form).getByLabelText('Type'), 'anthropic')

    expect(within(form).getByLabelText('Display name')).toHaveValue('Anthropic')
    expect(within(form).getByLabelText('Base URL')).toHaveValue('https://api.anthropic.com')
  })

  it('tests, disables, replaces the key of, and deletes a provider', async () => {
    backend.providers.push({
      id: 'p1',
      kind: 'openai',
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      enabled: true,
      has_api_key: false,
      api_key_hint: null,
      builtin: false,
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderSettings()
    const provider = await card('OpenRouter')

    await user.click(within(provider).getByRole('button', { name: 'Test' }))
    expect(await within(provider).findByRole('status')).toHaveTextContent('rejected the API key')

    await user.click(within(provider).getByRole('button', { name: 'Add' }))
    await user.type(within(provider).getByLabelText('New API key for OpenRouter'), 'sk-or-abcd1234')
    await user.click(within(provider).getByRole('button', { name: 'Save key' }))
    expect(await within(provider).findByText('Saved (…1234)')).toBeInTheDocument()

    await user.click(within(provider).getByRole('checkbox', { name: 'Enabled' }))
    expect(await within(provider).findByText('Disabled')).toBeInTheDocument()

    await user.click(within(provider).getByRole('button', { name: 'Delete OpenRouter' }))
    await vi.waitFor(() => expect(screen.queryByRole('listitem', { name: 'OpenRouter' })).not.toBeInTheDocument())
    expect(backend.providers.map((p) => p.id)).toEqual(['ollama'])
  })
})
