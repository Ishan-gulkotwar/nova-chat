import { useState, type FormEvent, type KeyboardEvent } from 'react'

interface ComposerProps {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  disabled?: boolean
}

/** The message input. Enter sends, Shift+Enter adds a new line. */
export function Composer({ onSend, onStop, isStreaming, disabled = false }: ComposerProps) {
  const [text, setText] = useState('')
  const canSend = !disabled && !isStreaming && text.trim().length > 0

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!canSend) return
    onSend(text)
    setText('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: don't send while an IME (e.g. Japanese input) is mid-word.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 pb-4">
      <label htmlFor="composer" className="sr-only">
        Message
      </label>
      <textarea
        id="composer"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Select a model to start chatting' : 'Send a message…'}
        disabled={disabled}
        rows={Math.min(8, Math.max(1, text.split('\n').length))}
        className="flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-indigo-500 disabled:opacity-50"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="rounded-xl bg-zinc-200 px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-white"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40"
        >
          Send
        </button>
      )}
    </form>
  )
}
