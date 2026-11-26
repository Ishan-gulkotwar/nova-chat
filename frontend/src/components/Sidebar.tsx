import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, NavLink, useMatch, useNavigate } from 'react-router'

import { useDebouncedValue } from '../hooks/useDebouncedValue.ts'
import { api } from '../lib/api.ts'
import { queryKeys } from '../lib/queryKeys.ts'
import { ConversationItem } from './ConversationItem.tsx'

/** Left column: app title, "New chat", search, and the list of saved chats. */
export function Sidebar() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // The sidebar lives outside <Routes>, so read the open chat's id from the URL directly.
  const activeId = useMatch('/c/:conversationId')?.params.conversationId

  const [search, setSearch] = useState('')
  const query = useDebouncedValue(search.trim(), 250) // don't hit the API on every keystroke

  const health = useQuery({ queryKey: queryKeys.health, queryFn: api.health, retry: false })
  const conversations = useQuery({
    queryKey: queryKeys.conversationList(query),
    queryFn: () => api.conversations.list(query || undefined),
    placeholderData: (previous) => previous, // keep showing old results while searching
  })

  const refreshList = () => queryClient.invalidateQueries({ queryKey: queryKeys.conversations })

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.conversations.update(id, { title }),
    onSuccess: () => refreshList(),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.conversations.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.conversation(id) })
      void refreshList()
      if (id === activeId) navigate('/')
    },
  })

  function handleDelete(id: string, title: string) {
    if (window.confirm(`Delete "${title}"? This can't be undone.`)) remove.mutate(id)
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          Nova Chat
        </Link>
        <span
          title={health.isSuccess ? `Backend v${health.data.version}` : 'Backend unreachable'}
          aria-label={health.isSuccess ? 'Backend connected' : 'Backend unreachable'}
          className={`h-2 w-2 rounded-full ${health.isSuccess ? 'bg-emerald-500' : health.isError ? 'bg-red-500' : 'bg-zinc-500'}`}
        />
      </div>

      <div className="space-y-2 px-3 pb-3">
        <Link
          to="/"
          className="block rounded-lg border border-zinc-700 px-3 py-2 text-center text-sm font-medium hover:bg-zinc-800"
        >
          + New chat
        </Link>
        <label htmlFor="search" className="sr-only">
          Search chats
        </label>
        <input
          id="search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats…"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-indigo-500"
        />
      </div>

      <nav aria-label="Chats" className="flex-1 overflow-y-auto pb-4">
        {conversations.isError && <p className="px-4 text-sm text-red-400">Couldn't load chats.</p>}
        {conversations.data?.length === 0 && (
          <p className="px-4 text-sm text-zinc-500">{query ? 'No matching chats.' : 'No chats yet.'}</p>
        )}
        <ul className="space-y-0.5">
          {conversations.data?.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              onRename={(title) => rename.mutate({ id: conversation.id, title })}
              onDelete={() => handleDelete(conversation.id, conversation.title)}
            />
          ))}
        </ul>
      </nav>

      <div className="border-t border-zinc-800 p-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'}`
          }
        >
          ⚙ Settings
        </NavLink>
      </div>
    </aside>
  )
}
