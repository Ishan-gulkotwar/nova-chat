import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { AddProviderForm } from '../components/AddProviderForm.tsx'
import { ProviderCard } from '../components/ProviderCard.tsx'
import { api, type ProviderCreate, type ProviderUpdate } from '../lib/api.ts'
import { queryKeys } from '../lib/queryKeys.ts'

/** Manage LLM providers: built-in Ollama plus cloud APIs with encrypted keys. */
export function SettingsPage() {
  const queryClient = useQueryClient()
  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: api.providers.list })

  // Any provider change can change which models exist, so refresh both lists.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.providers })
    void queryClient.invalidateQueries({ queryKey: queryKeys.models })
  }

  const create = useMutation({ mutationFn: (body: ProviderCreate) => api.providers.create(body), onSuccess: refresh })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProviderUpdate }) => api.providers.update(id, body),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.providers.remove(id), onSuccess: refresh })

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="border-b border-zinc-800 px-4 py-3">
        <h2 className="font-medium">Settings</h2>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          <section className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold">Model providers</h3>
              <p className="text-sm text-zinc-400">
                Models from every enabled provider appear in the model picker. You can switch models in the middle
                of a chat.
              </p>
            </div>

            {providers.isPending && <p className="text-sm text-zinc-500">Loading…</p>}
            {providers.isError && <p className="text-sm text-red-400">{providers.error.message}</p>}
            {(update.error || remove.error) && (
              <p role="alert" className="text-sm text-red-400">
                {(update.error ?? remove.error)?.message}
              </p>
            )}

            <ul className="space-y-3">
              {providers.data?.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onUpdate={(body) => update.mutate({ id: provider.id, body })}
                  onDelete={() => {
                    if (window.confirm(`Remove ${provider.name}? Its saved API key will be deleted.`)) {
                      remove.mutate(provider.id)
                    }
                  }}
                />
              ))}
            </ul>
          </section>

          <AddProviderForm
            onAdd={(body) => create.mutate(body)}
            isSaving={create.isPending}
            error={create.error?.message}
          />
        </div>
      </main>
    </div>
  )
}
