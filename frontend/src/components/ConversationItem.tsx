import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { NavLink } from 'react-router'

import type { Conversation } from '../lib/api.ts'

interface ConversationItemProps {
  conversation: Conversation
  onRename: (title: string) => void
  onDelete: () => void
}

/** One row in the sidebar: a link to the chat, with inline rename and delete. */
export function ConversationItem({ conversation, onRename, onDelete }: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(conversation.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) inputRef.current?.select()
  }, [isEditing])

  function startEditing() {
    setDraft(conversation.title)
    setIsEditing(true)
  }

  function commit() {
    const title = draft.trim()
    if (title && title !== conversation.title) onRename(title)
    setIsEditing(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') setIsEditing(false)
  }

  if (isEditing) {
    return (
      <li className="px-2">
        <input
          ref={inputRef}
          aria-label="Chat title"
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          className="w-full rounded-md border border-indigo-500 bg-zinc-950 px-2 py-1.5 text-sm outline-none"
        />
      </li>
    )
  }

  return (
    <li className="group relative px-2">
      <NavLink
        to={`/c/${conversation.id}`}
        className={({ isActive }) =>
          `block truncate rounded-md py-2 pr-14 pl-3 text-sm ${
            isActive ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'
          }`
        }
        title={conversation.title}
      >
        {conversation.title}
      </NavLink>
      <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 gap-1 group-focus-within:flex group-hover:flex">
        <button
          type="button"
          onClick={startEditing}
          aria-label={`Rename ${conversation.title}`}
          className="rounded px-1 text-xs text-zinc-400 hover:text-white"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${conversation.title}`}
          className="rounded px-1 text-xs text-zinc-400 hover:text-red-400"
        >
          ✕
        </button>
      </div>
    </li>
  )
}
