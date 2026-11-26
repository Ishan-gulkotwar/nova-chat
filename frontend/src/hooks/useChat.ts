import { useCallback, useEffect, useRef, useState } from 'react'

import { streamChat, type ChatMessage } from '../lib/api.ts'

export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error'

/** A message as the UI sees it: the wire format plus an id and a status. */
export interface UiMessage extends ChatMessage {
  id: string
  status: MessageStatus
  error?: string
}

let nextId = 0
const newId = () => `msg-${++nextId}`

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Owns the conversation state and the streaming lifecycle.
 *
 * Components stay simple: they render `messages`, call `send()` and `stop()`,
 * and disable inputs while `isStreaming` is true.
 */
export function useChat(model: string | undefined) {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Abort any in-flight request if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])

  const updateMessage = useCallback((id: string, patch: (m: UiMessage) => Partial<UiMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)))
  }, [])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || !model || isStreaming) return

      const userMessage: UiMessage = { id: newId(), role: 'user', content, status: 'done' }
      const assistantId = newId()

      // Send only completed turns as context; skip failed or empty replies.
      const history: ChatMessage[] = [...messages, userMessage]
        .filter((m) => m.status !== 'error' && m.content.length > 0)
        .map(({ role, content }) => ({ role, content }))

      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: 'assistant', content: '', status: 'streaming' },
      ])
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        await streamChat(
          { model, messages: history },
          {
            signal: controller.signal,
            onToken: (token) => updateMessage(assistantId, (m) => ({ content: m.content + token })),
          },
        )
        updateMessage(assistantId, () => ({ status: 'done' }))
      } catch (error) {
        if (isAbortError(error)) {
          updateMessage(assistantId, () => ({ status: 'stopped' }))
        } else {
          const message = error instanceof Error ? error.message : 'Something went wrong'
          updateMessage(assistantId, () => ({ status: 'error', error: message }))
        }
      } finally {
        abortRef.current = null
        setIsStreaming(false)
      }
    },
    [model, isStreaming, messages, updateMessage],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
  }, [])

  return { messages, isStreaming, send, stop, reset }
}
