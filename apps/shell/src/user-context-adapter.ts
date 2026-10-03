import {
  UserContextError,
  type UserContextAdapter,
  type StateRecord,
  type UserContextErrorCode,
} from '@company/mfe-react/host'

async function request<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`http://localhost:3010/api/user-context/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    // A proxy or crash can answer with a body that is not JSON; the status still classifies it.
    const failure = (await response.json().catch(() => ({}))) as {
      code?: string
      id?: string
      message?: string
    }
    const supported: readonly UserContextErrorCode[] = [
      'unauthorized-owner',
      'invalid-value',
      'unsupported-contract',
      'not-ready',
      'scope-disposed',
      'conflict',
      'persistence-failed',
    ]
    const code = supported.find(candidate => failure.code === `user-context/${candidate}`)
    throw new UserContextError(
      code ?? (response.status === 409 ? 'conflict' : 'persistence-failed'),
      failure.id ?? '<demo>',
      failure.message ?? `Example API returned ${String(response.status)}`,
    )
  }
  return (await response.json()) as T
}

export const userContextAdapter: UserContextAdapter = {
  hydrate: (ids, signal) => request<readonly StateRecord[]>('hydrate', { ids }, signal),
  write: (operation, signal) =>
    request<StateRecord>(`write/${encodeURIComponent(operation.id)}`, operation, signal),
}
