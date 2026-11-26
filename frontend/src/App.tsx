import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Composer } from './components/Composer.tsx'
import { MessageList } from './components/MessageList.tsx'
import { ModelSelector } from './components/ModelSelector.tsx'
import { useChat } from './hooks/useChat.ts'
import { api } from './lib/api.ts'

export default function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false })
  const models = useQuery({ queryKey: ['models'], queryFn: api.models, retry: false })

  // The user's pick, or the first available model until they choose one.
  const [pickedModel, setPickedModel] = useState<string>()
  const model = pickedModel ?? models.data?.[0]?.id

  const { messages, isStreaming, send, stop, reset } = useChat(model)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Nova Chat</h1>
        <span
          title={health.isSuccess ? `Backend v${health.data.version}` : 'Backend unreachable'}
          aria-label={health.isSuccess ? 'Backend connected' : 'Backend unreachable'}
          className={`h-2 w-2 rounded-full ${health.isSuccess ? 'bg-emerald-500' : health.isError ? 'bg-red-500' : 'bg-zinc-500'}`}
        />
        <div className="ml-auto flex items-center gap-2">
          <ModelSelector
            models={models.data ?? []}
            value={model}
            onChange={setPickedModel}
            disabled={isStreaming}
          />
          <button
            type="button"
            onClick={reset}
            disabled={messages.length === 0}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-40"
          >
            New chat
          </button>
        </div>
      </header>

      {models.isError && (
        <div role="alert" className="border-b border-red-900 bg-red-950/50 px-4 py-2 text-sm text-red-300">
          {models.error.message}
        </div>
      )}

      <main className="flex-1 overflow-y-auto">
        <MessageList messages={messages} />
      </main>

      <footer className="pt-2">
        <Composer onSend={send} onStop={stop} isStreaming={isStreaming} disabled={!model} />
      </footer>
    </div>
  )
}
