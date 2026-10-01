export { SharedStateRuntime, type SharedStateOptions } from './store.ts'
export {
  createSharedStateBackend,
  type SharedStateBackendOptions,
  type SharedStateRepository,
  type StoredState,
} from './backend.ts'
export {
  prepareSharedStateMount,
  emptySharedStateStore,
  type SharedStateDefinition,
} from './mount.ts'
export * from '@company/mfe-core/shared-state'
