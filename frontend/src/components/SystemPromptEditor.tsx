import { useState } from 'react'

interface SystemPromptEditorProps {
  value: string
  onSave: (value: string) => void
  onClose: () => void
  isSaving?: boolean
}

/**
 * Edits the chat's system prompt: hidden instructions sent before every
 * message, e.g. "You are a concise Python tutor. Answer with code first."
 */
export function SystemPromptEditor({ value, onSave, onClose, isSaving = false }: SystemPromptEditorProps) {
  const [draft, setDraft] = useState(value)

  return (
    <div className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="mx-auto max-w-3xl space-y-2">
        <label htmlFor="system-prompt" className="block text-sm font-medium text-zinc-300">
          System prompt
        </label>
        <textarea
          id="system-prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          maxLength={20_000}
          placeholder="e.g. You are a concise Python tutor. Answer with code first."
          className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm hover:bg-zinc-800">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft.trim())}
            disabled={isSaving}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
