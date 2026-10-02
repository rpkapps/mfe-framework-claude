/** Test-only storage. It deliberately makes no durable/offline persistence guarantee. */
import type { UserContextRepository, StoredState } from '../user-context/backend.ts'
export { createUserContextBackend } from '../user-context/backend.ts'
export function createTestUserContextRepository() {
  const records = new Map<string, StoredState>()
  const repository: UserContextRepository = {
    read: (scope, id) => Promise.resolve(records.get(`${scope}/${id}`)),
    transact: (scope, id, update, signal) => {
      if (signal.aborted)
        return Promise.reject(new Error('Operation aborted', { cause: signal.reason }))
      const key = `${scope}/${id}`
      const next = update(records.get(key))
      records.set(key, structuredClone(next))
      return Promise.resolve(structuredClone(next))
    },
  }
  return { repository, records }
}
