export { UserContextRuntime, type UserContextOptions } from './store.ts'
export {
  createUserContextBackend,
  type UserContextBackendOptions,
  type UserContextRepository,
  type StoredState,
} from './backend.ts'
export {
  prepareUserContextMount,
  emptyUserContextStore,
  type UserContextDefinition,
} from './mount.ts'
export * from '@company/mfe-core/user-context'

export type { HostUserContextOptions, HostUserContextDefinition } from './host.ts'

/** Public browser adapter; the core scoped transport remains an internal server/test protocol. */
export type { UserContextAdapter, StateWrite } from './host.ts'
