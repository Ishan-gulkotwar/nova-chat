import type { ModelChoice, ModelInfo } from '../lib/api.ts'

interface ModelSelectorProps {
  models: ModelInfo[]
  value: ModelChoice | undefined
  onChange: (choice: ModelChoice) => void
  disabled?: boolean
}

// A <select> value is a single string, so (provider, model) is packed into one.
// Provider ids never contain "::", so splitting on the first one is safe.
const SEPARATOR = '::'
const encode = ({ provider, model }: ModelChoice) => `${provider}${SEPARATOR}${model}`
function decode(value: string): ModelChoice {
  const index = value.indexOf(SEPARATOR)
  return { provider: value.slice(0, index), model: value.slice(index + SEPARATOR.length) }
}

/** Model dropdown, grouped by provider (Ollama, Groq, Anthropic, ...). */
export function ModelSelector({ models, value, onChange, disabled = false }: ModelSelectorProps) {
  const groups = new Map<string, ModelInfo[]>()
  for (const model of models) {
    const label = model.provider_name || model.provider
    groups.set(label, [...(groups.get(label) ?? []), model])
  }

  return (
    <>
      <label htmlFor="model" className="sr-only">
        Model
      </label>
      <select
        id="model"
        value={value ? encode(value) : ''}
        onChange={(e) => onChange(decode(e.target.value))}
        disabled={disabled || models.length === 0}
        className="max-w-64 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
      >
        {models.length === 0 && <option value="">No models</option>}
        {[...groups].map(([label, groupModels]) => (
          <optgroup key={label} label={label}>
            {groupModels.map((model) => {
              const value = encode({ provider: model.provider, model: model.id })
              return (
                <option key={value} value={value}>
                  {model.name}
                </option>
              )
            })}
          </optgroup>
        ))}
      </select>
    </>
  )
}
