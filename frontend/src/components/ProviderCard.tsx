import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type Provider, type ProviderUpdate } from '../lib/api.ts'

interface ProviderCardProps {
  provider: Provider
  onUpdate: (body: ProviderUpdate) => void
  onDelete: () => void
}

const kindLabel: Record<Provider['kind'], string> = {
  ollama: 'Local',
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
}

/** One configured provider: status, connection test, enable/disable, key replacement, delete. */
export function ProviderCard({ provider, onUpdate, onDelete }: ProviderCardProps) {
  const [isReplacingKey, setIsReplacingKey] = useState(false)
  const [newKey, setNewKey] = useState('')
  const test = useMutation({ mutationFn: () => api.providers.test(provider.id) })

  function saveKey() {
    onUpdate({ api_key: newKey.trim() })
    setNewKey('')
    setIsReplacingKey(false)
    test.reset()
  }

  return (
    <li
      aria-label={provider.name}
      className={`space-y-3 rounded-xl border border-zinc-800 p-4 ${provider.enabled ? '' : 'opacity-60'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{provider.name}</h3>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{kindLabel[provider.kind]}</span>
        {!provider.enabled && <span className="text-xs text-zinc-500">Disabled</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            className="rounded-lg border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800 disabled:opacity-50"
          >
            {test.isPending ? 'Testing…' : 'Test'}
          </button>
          {!provider.builtin && (
            <>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={provider.enabled}
                  onChange={(e) => onUpdate({ enabled: e.target.checked })}
                  className="accent-indigo-500"
                />
                Enabled
              </label>
              <button
                type="button"
                onClick={onDelete}
                aria-label={`Delete ${provider.name}`}
                className="rounded-lg px-2 py-1 text-sm text-zinc-400 hover:text-red-400"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
        <dt className="text-zinc-500">URL</dt>
        <dd className="truncate font-mono text-xs leading-5 text-zinc-300">{provider.base_url}</dd>
        {!provider.builtin && (
          <>
            <dt className="text-zinc-500">API key</dt>
            <dd className="flex items-center gap-2 text-zinc-300">
              {provider.has_api_key ? `Saved (${provider.api_key_hint})` : 'None'}
              <button
                type="button"
                onClick={() => setIsReplacingKey((open) => !open)}
                className="text-xs text-indigo-400 hover:underline"
              >
                {provider.has_api_key ? 'Replace' : 'Add'}
              </button>
            </dd>
          </>
        )}
      </dl>

      {provider.builtin && (
        <p className="text-xs text-zinc-500">
          Built in. Configure it with <code>OLLAMA_ENABLED</code> and <code>OLLAMA_BASE_URL</code> in{' '}
          <code>backend/.env</code>.
        </p>
      )}

      {isReplacingKey && (
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            aria-label={`New API key for ${provider.name}`}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={saveKey}
            disabled={!newKey.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm hover:bg-indigo-500 disabled:opacity-40"
          >
            Save key
          </button>
        </div>
      )}

      {test.data && (
        <p role="status" className={`text-sm ${test.data.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {test.data.ok ? `✓ Connected · ${test.data.model_count} models` : `✗ ${test.data.error}`}
        </p>
      )}
      {test.error && <p className="text-sm text-red-400">✗ {test.error.message}</p>}
    </li>
  )
}
