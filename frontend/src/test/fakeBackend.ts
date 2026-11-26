/**
 * An in-memory stand-in for the FastAPI backend, installed as `fetch`.
 * Lets UI tests exercise real flows (create chat, stream, rename, delete, search)
 * without a server.
 */
import { vi } from 'vitest'

import type { ConversationDetail, StoredMessage } from '../lib/api.ts'

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
    return { id: this.nextId++, role, content, model: null, status, error: null, created_at: this.now() }
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
    if (pathname === '/api/models') {
      return Response.json([{ id: 'llama3.2:latest', name: 'llama3.2', provider: 'ollama', size_bytes: 1 }])
    }

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

    if (match[2]) return this.stream(conversation, body!.content, init.signal ?? undefined)
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

  private stream(conversation: ConversationDetail, content: string, signal?: AbortSignal): Response {
    const plan = this.streamPlan
    conversation.messages.push(this.message('user', content))
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
    conversation.messages.push({ ...reply, error: plan.error ?? null })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
}
