import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api } from './lib/api.ts'

/**
 * Phase 1 landing page: proves the React app can reach the FastAPI backend.
 * Replaced by the chat UI in Phase 2.
 */
export default function App() {
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('world')

  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false })
  const hello = useQuery({
    queryKey: ['hello', name],
    queryFn: () => api.hello(name),
    enabled: health.isSuccess, // don't call /hello until we know the backend is up
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (trimmed) setName(trimmed)
  }

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Nova Chat</h1>
          <p className="text-sm text-zinc-400">A self-hosted AI chat app. Phase 1: hello world.</p>
        </header>

        <section aria-label="Backend status" className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${
              health.isSuccess ? 'bg-emerald-500' : health.isError ? 'bg-red-500' : 'bg-zinc-500'
            }`}
          />
          {health.isPending && <span>Checking backend…</span>}
          {health.isSuccess && <span>Backend connected (v{health.data.version})</span>}
          {health.isError && <span className="text-red-400">Backend unreachable</span>}
        </section>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <label htmlFor="name" className="sr-only">
            Your name
          </label>
          <input
            id="name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your name"
            maxLength={50}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            disabled={!health.isSuccess}
          >
            Say hi
          </button>
        </form>

        {hello.data && (
          <p role="status" className="rounded-lg bg-zinc-800 px-4 py-3 text-sm">
            {hello.data.message}
          </p>
        )}
      </div>
    </main>
  )
}
