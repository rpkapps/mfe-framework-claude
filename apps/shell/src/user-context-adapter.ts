import {
  USER_CONTEXT_ERROR_CODES,
  UserContextError,
  type UserContextAdapter,
  type StateRecord,
} from '@company/mfe-react/host'

async function request<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`http://localhost:3010/api/user-context/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    // A proxy or crash can answer with a body that is not JSON; that is a persistence failure.
    const failure = (await response.json().catch(() => ({}))) as {
      code?: string
      id?: string
      message?: string
    }
    const code = USER_CONTEXT_ERROR_CODES.find(
      candidate => failure.code === `user-context/${candidate}`,
    )
    throw new UserContextError(
      code ?? 'persistence-failed',
      failure.id ?? '<demo>',
      failure.message ?? `Example API returned ${String(response.status)}`,
    )
  }
  return (await response.json()) as T
}

export const userContextAdapter: UserContextAdapter = {
  hydrate: (ids, signal) => request<readonly StateRecord[]>('hydrate', { ids }, signal),
  write: (write, signal) =>
    request<StateRecord>(`write/${encodeURIComponent(write.id)}`, write, signal),
}
