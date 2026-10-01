import {
  SharedStateError,
  type SharedStateAdapter,
  type SharedStateOptions,
  type StateRecord,
} from '@company/mfe-runtime/shared-state'
import { schema } from '@example/shared-state-contracts/schema'

async function request<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`http://localhost:3010/api/shared-state/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const failure = (await response.json()) as { message?: string }
    throw new SharedStateError(
      response.status === 409 ? 'conflict' : 'persistence-failed',
      '<demo>',
      failure.message ?? `Example API returned ${String(response.status)}`,
    )
  }
  return (await response.json()) as T
}

const adapter: SharedStateAdapter = {
  hydrate: (scope, ids, signal) =>
    request<readonly StateRecord[]>('hydrate', { scope, ids }, signal),
  write: (operation, signal) => request<StateRecord>('write', operation, signal),
}

/** A fixed demo workspace lets the React and Angular examples read the same saved records. */
export function createDemoSharedState(): SharedStateOptions {
  return { schema, scope: 'shared-state-example', adapter }
}
