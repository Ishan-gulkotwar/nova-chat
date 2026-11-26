import type { ProviderCreate } from './api.ts'

/** Common providers, so adding one is "pick, paste key, done". */
export interface ProviderPreset {
  id: string
  label: string
  kind: ProviderCreate['kind']
  name: string
  baseUrl: string
  keyUrl?: string
  keyRequired: boolean
  note?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'groq',
    label: 'Groq (free tier)',
    kind: 'openai',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    keyRequired: true,
    note: 'Fast open models (Llama, Qwen, ...) with a free tier.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyRequired: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    keyRequired: true,
    note: 'One key for models from many vendors.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyRequired: true,
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible API',
    kind: 'openai',
    name: '',
    baseUrl: '',
    keyRequired: false,
    note: 'Anything that serves /models and /chat/completions, e.g. LM Studio or vLLM.',
  },
]
