import { useEffect, useRef } from 'react'

import type { UiMessage } from '../hooks/useChat.ts'
import { Markdown } from './Markdown.tsx'

function MessageBubble({ message }: { message: UiMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-indigo-600 px-4 py-2.5 whitespace-pre-wrap text-white">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="assistant-message">
      {message.content && <Markdown content={message.content} />}
      {message.status === 'streaming' && !message.content && (
        <span className="inline-flex gap-1" aria-label="Assistant is thinking">
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500" />
        </span>
      )}
      {message.status === 'stopped' && <p className="text-xs text-zinc-500">Stopped</p>}
      {message.status === 'error' && (
        <p role="alert" className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {message.error}
        </p>
      )}
    </div>
  )
}

export function MessageList({ messages }: { messages: UiMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Keep the newest text in view while tokens stream in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-500">
        <p className="text-2xl font-semibold text-zinc-300">How can I help?</p>
        <p className="text-sm">Pick a model above and send a message. Your chats are saved on the left.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
