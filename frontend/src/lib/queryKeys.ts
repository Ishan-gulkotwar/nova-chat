/**
 * TanStack Query cache keys in one place, so a mutation can't invalidate a
 * key that's spelled slightly differently from the query that uses it.
 */
export const queryKeys = {
  health: ['health'] as const,
  models: ['models'] as const,
  providers: ['providers'] as const,
  conversations: ['conversations'] as const,
  conversationList: (q: string) => ['conversations', 'list', q] as const,
  conversation: (id: string) => ['conversation', id] as const,
}
