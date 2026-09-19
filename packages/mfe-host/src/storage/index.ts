/**
 * The host's validated browser-storage module.
 *
 * One `MfeStorageStore` owns every read and write the framework makes to
 * `localStorage` and `sessionStorage`: key scoping by definition id, schema
 * validation in both directions, the persisted envelope, session generations
 * and migration. Nothing else in the framework touches a browser store.
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
