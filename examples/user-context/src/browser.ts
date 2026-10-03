import {
  UserContextError,
  type UserContextAdapter,
  type HostUserContextOptions,
  type StateRecord,
  type UserContextErrorCode,
} from '@company/mfe-runtime/user-context'

async function request<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`http://localhost:3010/api/user-context/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const failure = (await response.json()) as { code?: string; id?: string; message?: string }
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

const adapter: UserContextAdapter = {
  hydrate: (scope, ids, signal) =>
    request<readonly StateRecord[]>('hydrate', { scope, ids }, signal),
  write: (operation, signal) =>
    request<StateRecord>(`write/${encodeURIComponent(operation.id)}`, operation, signal),
}

/** The runtime derives the scope from shell identity and loads contracts from the registry. */
export function createDemoUserContext(): HostUserContextOptions {
  return { adapter }
}
