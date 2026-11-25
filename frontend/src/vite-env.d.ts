/// <reference types="vite/client" />

// Typed environment variables. Only variables prefixed with VITE_ are exposed
// to browser code, so never put secrets here.
interface ImportMetaEnv {
  /** Backend origin, e.g. https://api.example.com. Empty = same origin (dev proxy). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
