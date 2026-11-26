/**
 * An in-memory stand-in for the FastAPI backend, installed as `fetch`.
 * Lets UI tests exercise real flows (create chat, stream, rename, delete, search)
 * without a server.
 */
import { vi } from 'vitest'

import type { ConversationDetail, ModelsResponse, Provider, StoredMessage } from '../lib/api.ts'

const encoder = new TextEncoder()
const token = (content: string) => `event: token\ndata: ${JSON.stringify({ content })}\n\n`

export interface StreamPlan {
  chunks: string[]
  /** Keep the stream open after the chunks, until the request is aborted. */
  keepOpen?: boolean
  /** End with an `error` event instead of `done`. */
  error?: string
}

export class FakeBackend {
  conversations = new Map<string, ConversationDetail>()
  modelsResponse: ModelsResponse = {
    models: [
      { id: 'llama3.2:latest', name: 'llama3.2', provider: 'ollama', provider_name: 'Ollama', size_bytes: 1 },
      { id: 'llama-3.3-70b', name: 'llama-3.3-70b', provider: 'groq1', provider_name: 'Groq', size_bytes: null },
    ],
    errors: [],
  }
  providers: Provider[] = [
    {
      id: 'ollama',
      kind: 'ollama',
      name: 'Ollama',
      base_url: 'http://localhost:11434',
      enabled: true,
      has_api_key: false,
      api_key_hint: null,
      builtin: true,
    },
  ]
  streamPlan: StreamPlan = { chunks: ['Hello, ', '**world**'] }
  requests: { method: string; path: string; body: unknown }[] = []
  private nextId = 1
  private clock = Date.UTC(2026, 0, 1)

  /** Seed a saved conversation. */
  add(title: string, messages: Pick<StoredMessage, 'role' | 'content'>[] = [], systemPrompt = '') {
    const id = `c${this.nextId++}`
    this.conversations.set(id, {
      id,
      title,
      model: 'llama3.2:latest',
      provider: 'ollama',
      system_prompt: systemPrompt,
      created_at: this.now(),
      updated_at: this.now(),
      messages: messages.map((m) => this.message(m.role, m.content)),
    })
    return id
  }

  install() {
    const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) =>
      Promise.resolve(this.handle(input.toString(), init)),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  private now() {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }

  private message(role: StoredMessage['role'], content: string, status: StoredMessage['status'] = 'done') {
    return {
      id: this.nextId++,
      role,
      content,
      model: null,
      provider: null,
      status,
      error: null,
      created_at: this.now(),
    }
  }

  private summary({ messages: _messages, ...conversation }: ConversationDetail) {
    return conversation
  }

  private handle(url: string, init: RequestInit): Response {
    const { pathname, searchParams } = new URL(url, 'http://test')
    const method = init.method ?? 'GET'
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, string>) : undefined
    this.requests.push({ method, path: pathname, body })

    if (pathname === '/api/health') return Response.json({ status: 'ok', version: '0.3.0' })
    if (pathname === '/api/models') return Response.json(this.modelsResponse)
    if (pathname.startsWith('/api/providers')) return this.handleProviders(pathname, method, body)

    if (pathname === '/api/conversations' && method === 'GET') {
      const q = searchParams.get('q')?.toLowerCase()
      const list = [...this.conversations.values()]
        .filter(
          (c) =>
            !q ||
            c.title.toLowerCase().includes(q) ||
            c.messages.some((m) => m.content.toLowerCase().includes(q)),
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((c) => this.summary(c))
      return Response.json(list)
    }
    if (pathname === '/api/conversations' && method === 'POST') {
      const id = this.add(body?.title ?? 'New chat', [], body?.system_prompt ?? '')
      return Response.json(this.summary(this.conversations.get(id)!), { status: 201 })
    }

    const match = pathname.match(/^\/api\/conversations\/([^/]+)(\/messages\/stream)?$/)
    const conversation = match ? this.conversations.get(match[1]) : undefined
    if (!match || !conversation) return Response.json({ detail: 'Conversation not found' }, { status: 404 })

    if (match[2]) return this.stream(conversation, body!, init.signal ?? undefined)
    if (method === 'GET') return Response.json(conversation)
    if (method === 'PATCH') {
      Object.assign(conversation, body, { updated_at: this.now() })
      return Response.json(this.summary(conversation))
    }
    if (method === 'DELETE') {
      this.conversations.delete(conversation.id)
      return new Response(null, { status: 204 })
    }
    return new Response('not found', { status: 404 })
  }

  private handleProviders(pathname: string, method: string, body?: Record<string, unknown>): Response {
    const [, , , id, action] = pathname.split('/') // "", "api", "providers", id?, action?
    if (!id && method === 'GET') return Response.json(this.providers)
    if (!id && method === 'POST') {
      const key = body?.api_key as string | undefined
      const created: Provider = {
        id: `p${this.nextId++}`,
        kind: body!.kind as Provider['kind'],
        name: body!.name as string,
        base_url: body!.base_url as string,
        enabled: true,
        has_api_key: Boolean(key),
        api_key_hint: key ? `…${key.slice(-4)}` : null, // like the server: never the key itself
        builtin: false,
      }
      this.providers.push(created)
      return Response.json(created, { status: 201 })
    }
    const provider = this.providers.find((p) => p.id === id)
    if (!provider) return Response.json({ detail: 'Provider not found' }, { status: 404 })
    if (action === 'test') {
      return Response.json(
        provider.has_api_key || provider.builtin
          ? { ok: true, model_count: 3, error: null }
          : { ok: false, model_count: 0, error: `${provider.name} rejected the API key (401)` },
      )
    }
    if (method === 'PATCH') {
      const { api_key: key, ...rest } = body ?? {}
      Object.assign(provider, rest)
      if (typeof key === 'string') {
        provider.has_api_key = key.length > 0
        provider.api_key_hint = key ? `…${key.slice(-4)}` : null
      }
      return Response.json(provider)
    }
    if (method === 'DELETE') {
      this.providers = this.providers.filter((p) => p !== provider)
      return new Response(null, { status: 204 })
    }
    return new Response('not found', { status: 404 })
  }

  private stream(conversation: ConversationDetail, request: Record<string, string>, signal?: AbortSignal): Response {
    const plan = this.streamPlan
    const content = request.content
    conversation.messages.push(this.message('user', content))
    Object.assign(conversation, { model: request.model, provider: request.provider })
    if (conversation.title === 'New chat') conversation.title = content
    conversation.updated_at = this.now()

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of plan.chunks) controller.enqueue(encoder.encode(token(chunk)))
        if (plan.keepOpen) {
          // Like a real browser: aborting the request errors the body stream.
          signal?.addEventListener('abort', () =>
            controller.error(new DOMException('The operation was aborted.', 'AbortError')),
          )
          return
        }
        const end = plan.error
          ? `event: error\ndata: ${JSON.stringify({ message: plan.error })}\n\n`
          : 'event: done\ndata: {}\n\n'
        controller.enqueue(encoder.encode(end))
        controller.close()
      },
    })
    // Saved like the real server does: a failed reply keeps its status and error.
    const reply = this.message('assistant', plan.chunks.join(''), plan.error ? 'error' : 'done')
    conversation.messages.push({
      ...reply,
      model: request.model,
      provider: request.provider,
      error: plan.error ?? null,
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
}
