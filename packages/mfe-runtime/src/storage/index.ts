/**
 * One `MfeStorageStore` owns every read and write the framework makes to `localStorage`
 * and `sessionStorage`; nothing else in the framework touches a browser store.
 */

export { MfeStorageStore } from './storage-store.ts'

export type {
  BoundStorageKey,
  MfeStorageStoreOptions,
  SessionTransitionOutcome,
  SessionTransitionResult,
  StorageAreaLike,
  StorageAreaSource,
  StorageEventLike,
  StorageEventTargetLike,
  StorageKeyBinding,
  StorageSessionTransition,
  StorageUpdater,
  StorageWriteOptions,
} from './types.ts'

/** Exported for a host that assembles its own runtime instead of calling `createMfeRuntime`. */
export {
  establishSessionGeneration,
  mintSessionGeneration,
  recordSessionGeneration,
  type EstablishedSessionGeneration,
  type EstablishSessionGenerationOptions,
} from './session-generation.ts'
