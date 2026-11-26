import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { Composer } from '../components/Composer.tsx'
import { MessageList } from '../components/MessageList.tsx'
import { ModelSelector } from '../components/ModelSelector.tsx'
import { SystemPromptEditor } from '../components/SystemPromptEditor.tsx'
import { toUiMessage, useChat } from '../hooks/useChat.ts'
import { ApiError, api, type ConversationDetail, type ModelChoice } from '../lib/api.ts'
import { queryKeys } from '../lib/queryKeys.ts'

/** Handed from the "new chat" page to the freshly created chat via router state. */
interface HandoffState {
  pendingMessage: string
  choice: ModelChoice
}

/**
 * The chat screen. Rendered at "/" (a new, unsaved chat) and at
 * "/c/:conversationId" (a saved chat).
 *
 * A new chat is only created in the database when its first message is sent:
 * we create it, navigate to its URL, and the new page sends the message.
 */
export function ChatPage() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  const models = useQuery({ queryKey: queryKeys.models, queryFn: api.models, retry: false })
  const detail = useQuery({
    queryKey: queryKeys.conversation(conversationId ?? ''),
    queryFn: () => api.conversations.get(conversationId!),
    enabled: Boolean(conversationId),
    retry: false,
  })

  // Model: the user's pick, else the one this chat last used (if still available), else the first.
  // It can be changed at any point; each message records which model answered it.
  const [picked, setPicked] = useState<ModelChoice>()
  const available = models.data?.models ?? []
  const isAvailable = (c: { provider?: string | null; model?: string | null }) =>
    available.some((m) => m.provider === c.provider && m.id === c.model)
  const saved =
    detail.data?.model && detail.data.provider && isAvailable(detail.data)
      ? { provider: detail.data.provider, model: detail.data.model }
      : undefined
  const first = available[0] ? { provider: available[0].provider, model: available[0].id } : undefined
  const choice = picked ?? saved ?? first

  // System prompt: stored on the conversation, or held locally until a new chat is created.
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('')
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const systemPrompt = conversationId ? (detail.data?.system_prompt ?? '') : draftSystemPrompt

  const { pending, isStreaming, send, stop } = useChat(conversationId)

  const createConversation = useMutation({ mutationFn: api.conversations.create })
  const updateSystemPrompt = useMutation({
    mutationFn: (value: string) => api.conversations.update(conversationId!, { system_prompt: value }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(updated.id), (old) =>
        old ? { ...old, ...updated } : old,
      )
      setIsEditingPrompt(false)
    },
  })

  // Pick up a first message handed over from the "new chat" page and send it.
  // The timeout + cleanup make this run exactly once, even under React StrictMode,
  // which mounts components twice in development.
  useEffect(() => {
    const handoff = location.state as HandoffState | null
    if (!conversationId || !handoff?.pendingMessage) return
    const timer = setTimeout(() => {
      navigate(location.pathname, { replace: true, state: null }) // don't resend on refresh
      void send(handoff.pendingMessage, handoff.choice)
    }, 0)
    return () => clearTimeout(timer)
  }, [conversationId, location.state, location.pathname, navigate, send])

  async function handleSend(text: string) {
    if (!choice) return
    if (conversationId) {
      void send(text, choice)
      return
    }
    const created = await createConversation.mutateAsync({ ...choice, system_prompt: draftSystemPrompt })
    queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(created.id), {
      ...created,
      messages: [],
    })
    const handoff: HandoffState = { pendingMessage: text, choice }
    navigate(`/c/${created.id}`, { state: handoff })
  }

  function handleSaveSystemPrompt(value: string) {
    if (conversationId) updateSystemPrompt.mutate(value)
    else {
      setDraftSystemPrompt(value)
      setIsEditingPrompt(false)
    }
  }

  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
        <p>This chat doesn't exist (it may have been deleted).</p>
        <Link to="/" className="text-indigo-400 hover:underline">
          Start a new chat
        </Link>
      </div>
    )
  }

  const messages = [...(detail.data?.messages.map(toUiMessage) ?? []), ...pending]
  const errorBanner = models.error?.message ?? createConversation.error?.message
  // Some providers failed to list models (e.g. Ollama isn't running): warn, but keep the rest usable.
  const providerWarnings = models.data?.errors ?? []

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <h2 className="min-w-0 truncate font-medium">{detail.data?.title ?? 'New chat'}</h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setIsEditingPrompt((open) => !open)}
            aria-expanded={isEditingPrompt}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
          >
            System prompt
            {systemPrompt && <span aria-label="(set)" className="h-1.5 w-1.5 rounded-full bg-indigo-400" />}
          </button>
          <ModelSelector models={available} value={choice} onChange={setPicked} disabled={isStreaming} />
        </div>
      </header>

      {isEditingPrompt && (
        <SystemPromptEditor
          value={systemPrompt}
          onSave={handleSaveSystemPrompt}
          onClose={() => setIsEditingPrompt(false)}
          isSaving={updateSystemPrompt.isPending}
        />
      )}

      {errorBanner && (
        <div role="alert" className="border-b border-red-900 bg-red-950/50 px-4 py-2 text-sm text-red-300">
          {errorBanner}
        </div>
      )}

      {providerWarnings.length > 0 && (
        <div className="border-b border-amber-900/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
          {providerWarnings.map((w) => (
            <p key={w.provider}>
              <span className="font-medium">{w.provider_name}:</span> {w.message}{' '}
              <Link to="/settings" className="underline">
                Settings
              </Link>
            </p>
          ))}
          {available.length === 0 && (
            <p className="mt-1 text-amber-300">No models available. Start Ollama or add a provider in Settings.</p>
          )}
        </div>
      )}

      <main className="flex-1 overflow-y-auto">
        {conversationId && detail.isPending ? (
          <p className="p-6 text-center text-sm text-zinc-500">Loading…</p>
        ) : (
          <MessageList messages={messages} />
        )}
      </main>

      <footer className="pt-2">
        <Composer
          onSend={handleSend}
          onStop={stop}
          isStreaming={isStreaming || createConversation.isPending}
          disabled={!choice}
        />
      </footer>
    </div>
  )
}
