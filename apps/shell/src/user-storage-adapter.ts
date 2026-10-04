/**
 * The shell's `user` storage backend: the local example API in examples/user-storage. It never
 * names the user; the API decides whose rows it reads and writes from its own session.
 */

import type { CreateMfeRuntimeOptions } from '@company/mfe-react/host'

type UserStorageAdapter = NonNullable<NonNullable<CreateMfeRuntimeOptions['storage']>['user']>
type UserStorageState = Awaited<ReturnType<UserStorageAdapter['load']>>
type StoredRow = NonNullable<Awaited<ReturnType<UserStorageAdapter['save']>>>

const API = 'http://localhost:3010/api/user-storage'

/** A slow backend fails the load rather than holding every App back; `retry()` recovers. */
const LOAD_TIMEOUT_MS = 3000

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    // A proxy or crash can answer with a body that is not JSON.
    const failure = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(failure.message ?? `Example API returned ${String(response.status)}`)
  }
  return (await response.json()) as T
}

function rowUrl(owner: string, key: string): string {
  return `${API}/${encodeURIComponent(owner)}/${encodeURIComponent(key)}`
}

export const userStorageAdapter: UserStorageAdapter = {
  load: signal =>
    request<UserStorageState>(API, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(LOAD_TIMEOUT_MS)]),
    }),
  save: (owner, key, value, signal) =>
    value === null
      ? request<null>(rowUrl(owner, key), { method: 'DELETE', signal })
      : request<StoredRow>(rowUrl(owner, key), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
          signal,
        }),
}
