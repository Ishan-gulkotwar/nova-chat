import type { ModelInfo } from '../lib/api.ts'

interface ModelSelectorProps {
  models: ModelInfo[]
  value: string | undefined
  onChange: (modelId: string) => void
  disabled?: boolean
}

export function ModelSelector({ models, value, onChange, disabled = false }: ModelSelectorProps) {
  return (
    <>
      <label htmlFor="model" className="sr-only">
        Model
      </label>
      <select
        id="model"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || models.length === 0}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
      >
        {models.length === 0 && <option value="">No models</option>}
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name} · {model.provider}
          </option>
        ))}
      </select>
    </>
  )
}
