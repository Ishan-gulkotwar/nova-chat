import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  StreamError,
  streamMessage,
  type ConversationDetail,
  type MessageStatus,
  type Role,
  type StoredMessage,
} from '../lib/api.ts'
import { queryKeys } from '../lib/queryKeys.ts'

/** A message as the UI renders it. `streaming` exists only on the client. */
export interface UiMessage {
  id: string
  role: Role
  content: string
  status: MessageStatus | 'streaming'
  error?: string | null
}

export function toUiMessage(message: StoredMessage): UiMessage {
  return { ...message, id: String(message.id) }
}

let localId = 0
const newLocalId = () => `local-${++localId}`

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Streaming lifecycle for one conversation.
 *
 * The server is the source of truth for history (loaded with TanStack Query).
 * This hook only holds the *in-flight* turn: the user's message plus the
 * assistant reply being streamed. When the turn finishes, it's merged into the
 * cached conversation, exactly as the server saved it.
 */
export function useChat(conversationId: string | undefined) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<UiMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Abort any in-flight request if the user navigates away.
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(
    async (text: string, model: string) => {
      const content = text.trim()
      if (!conversationId || !content || !model || abortRef.current) return

      const user: UiMessage = { id: newLocalId(), role: 'user', content, status: 'done' }
      let reply: UiMessage = { id: newLocalId(), role: 'assistant', content: '', status: 'streaming' }
      const show = () => setPending([user, reply])
      show()
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller
      // True once the server has saved the user's message (i.e. streaming began).
      let saved = false

      try {
        await streamMessage(conversationId, { content, model }, {
          signal: controller.signal,
          onToken: (token) => {
            if (!saved) {
              saved = true
              // The server just saved the user's message and auto-title: refresh the sidebar.
              void queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
            }
            reply = { ...reply, content: reply.content + token }
            show()
          },
        })
        reply = { ...reply, status: 'done' }
        saved = true
      } catch (error) {
        if (isAbortError(error)) {
          reply = { ...reply, status: 'stopped' }
          saved = true
        } else {
          const message = error instanceof Error ? error.message : 'Something went wrong'
          reply = { ...reply, status: 'error', error: message }
          saved ||= error instanceof StreamError
        }
      } finally {
        abortRef.current = null
        setIsStreaming(false)
      }

      if (!saved) {
        // The request failed before the server stored anything: keep it on screen.
        show()
        return
      }

      // Merge the finished turn into the cached conversation, then drop the local copy.
      const detailKey = queryKeys.conversation(conversationId)
      queryClient.setQueryData<ConversationDetail>(detailKey, (old) =>
        old ? { ...old, model, messages: [...old.messages, ...[user, reply].map(toStored)] } : old,
      )
      setPending([])
      // Reload it from the server (e.g. to pick up the auto-generated title). The server
      // saves before sending `done`/`error`, so that's safe right away. A stopped reply
      // may still be saving, so then we only mark it stale and reload it next time.
      void queryClient.invalidateQueries({
        queryKey: detailKey,
        refetchType: reply.status === 'stopped' ? 'none' : 'active',
      })
      // The sidebar's titles and order changed.
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
    },
    [conversationId, queryClient],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { pending, isStreaming, send, stop }
}

let tempId = -1
function toStored(message: UiMessage): StoredMessage {
  return {
    id: tempId--, // placeholder until the next refetch brings the real id
    role: message.role,
    content: message.content,
    model: null,
    status: message.status === 'streaming' ? 'done' : message.status,
    error: message.error ?? null,
    created_at: new Date().toISOString(),
  }
}
