import { useState, type FormEvent } from 'react'

import type { ProviderCreate } from '../lib/api.ts'
import { PROVIDER_PRESETS } from '../lib/providerPresets.ts'

interface AddProviderFormProps {
  onAdd: (body: ProviderCreate) => void
  isSaving: boolean
  error?: string
}

const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500'

export function AddProviderForm({ onAdd, isSaving, error }: AddProviderFormProps) {
  const [presetId, setPresetId] = useState(PROVIDER_PRESETS[0].id)
  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId) ?? PROVIDER_PRESETS[0]
  const [name, setName] = useState(preset.name)
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl)
  const [apiKey, setApiKey] = useState('')

  function choosePreset(id: string) {
    const next = PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0]
    setPresetId(next.id)
    setName(next.name)
    setBaseUrl(next.baseUrl)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    onAdd({
      kind: preset.kind,
      name: name.trim(),
      base_url: baseUrl.trim(),
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
    })
    setApiKey('') // don't keep the key in memory longer than needed
  }

  const canSubmit = name.trim() && baseUrl.trim() && (!preset.keyRequired || apiKey.trim()) && !isSaving

  return (
    <form onSubmit={submit} aria-label="Add provider" className="space-y-3 rounded-xl border border-zinc-800 p-4">
      <h3 className="font-medium">Add a provider</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-zinc-400">Type</span>
          <select value={presetId} onChange={(e) => choosePreset(e.target.value)} className={inputClass}>
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-400">Display name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-zinc-400">Base URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://..."
            className={inputClass}
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-zinc-400">
            API key{!preset.keyRequired && ' (optional)'}
            {preset.keyUrl && (
              <>
                {' · '}
                <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                  get one
                </a>
              </>
            )}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      {preset.note && <p className="text-xs text-zinc-500">{preset.note}</p>}
      <p className="text-xs text-zinc-500">
        Keys are encrypted before they're stored and are never sent back to the browser.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40"
      >
        Add provider
      </button>
    </form>
  )
}
