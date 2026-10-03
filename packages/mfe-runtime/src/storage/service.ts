/**
 * The one storage API over all three areas. A key says where its value lives; everything a
 * caller sees — the value, status, error, an awaitable write — has the same shape in each.
 */

import {
  createStorageError,
  describeThrown,
  describeValue,
  HOST_SCOPE,
  isMfeError,
  isStoredKey,
  type AnyStoredKey,
  type Listener,
  type MfeStorage,
  type StorageError,
  type StorageSnapshot,
  type StoredSnapshot,
  type StoredUpdate,
  type StoredValue,
  type Unsubscribe,
  type UserStorageAdapter,
} from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'
import type { MfeStorageStore } from './storage-store.ts'
import type { BoundStorageKey } from './types.ts'
import { UserStorageStore, type UserRowState } from './user-store.ts'

/** Who is reading or writing: the mount's definition, or the host page outside any mount. */
export interface StorageCaller {
  readonly owner: string
  readonly instanceId?: string | undefined
  /** Aborts when the caller goes away; writes after that are refused. */
  readonly signal?: AbortSignal | undefined
}

/** Stable for its lifetime, so a `useSyncExternalStore` consumer does not churn. */
export interface StoredBinding<T> {
  getSnapshot(): StoredSnapshot<T>
  subscribe(listener: Listener): Unsubscribe
  set(next: StoredUpdate<T>): Promise<void>
  /** Removes the stored value, so the key reads its schema default again. */
  reset(): Promise<void>
  /** After a failed load, loads again; after a failed save, sends it again. */
  retry(): Promise<void>
  /** Drops this consumer; the browser key is torn down when the last one goes. */
  release(): void
}

export interface StorageServiceOptions {
  readonly browser: MfeStorageStore
  readonly user?: UserStorageAdapter | undefined
  readonly diagnostics?: DiagnosticsHub | undefined
}

type Decoded =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: StorageError }

export class StorageService {
  readonly browser: MfeStorageStore
  readonly user: UserStorageStore | undefined
  readonly #writeErrors = new Map<string, StorageError>()
  readonly #writeListeners = new Map<string, Set<Listener>>()
  /** The write that failed, sent again by `retry()`. */
  readonly #failedWrites = new Map<string, () => void>()
  /** Bindings per browser key; its write error goes with the last one. */
  readonly #writeBindings = new Map<string, number>()

  constructor(options: StorageServiceOptions) {
    this.browser = options.browser
    this.user =
      options.user === undefined
        ? undefined
        : new UserStorageStore({
            adapter: options.user,
            ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
          })
  }

  /** Settles once the user area has loaded or failed to; never rejects on a failed load. */
  whenLoaded(signal?: AbortSignal): Promise<void> {
    const loaded = this.user?.whenLoaded() ?? Promise.resolve()
    if (signal === undefined) return loaded
    if (signal.aborted) return Promise.reject(abortError(signal))
    return new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        reject(abortError(signal))
      }
      signal.addEventListener('abort', abort, { once: true })
      void loaded.then(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      })
    })
  }

  bind<T>(caller: StorageCaller, key: AnyStoredKey<T>): StoredBinding<T> {
    if (!isStoredKey(key))
      throw createStorageError('invalid-value', caller.owner, '<key>', 'bind a stored key', {
        expected: 'a key declared with storedKey() or storedKey.from()',
        observed: describeValue(key),
        repair: 'Declare the value once with storedKey(...) and pass that key.',
      })
    const owner = key.owner ?? caller.owner
    let instanceId: string | undefined
    if (key.perInstance) {
      if (typeof caller.instanceId !== 'string' || caller.instanceId.trim().length === 0)
        throw createStorageError('invalid-value', owner, key.name, 'bind a stored key', {
          expected: 'a stable host-supplied instanceId for a perInstance key',
          observed: describeValue(caller.instanceId),
          repair: 'Pass instanceId where the host places the widget, and keep it across remounts.',
        })
      instanceId = caller.instanceId
    }
    return key.storage === 'user'
      ? this.#bindUser(caller, owner, instanceId, key)
      : this.#bindBrowser(caller, owner, instanceId, key)
  }

  /** The imperative surface for a mount, a route callback or the host page. */
  forCaller(caller: StorageCaller): MfeStorage {
    const once = <T, R>(key: AnyStoredKey<T>, use: (binding: StoredBinding<T>) => R): R => {
      const binding = this.bind(caller, key)
      try {
        return use(binding)
      } finally {
        binding.release()
      }
    }
    return {
      get: async key => {
        await this.whenLoaded(caller.signal)
        return once(key, binding => binding.getSnapshot().value)
      },
      peek: key => once(key, binding => binding.getSnapshot().value),
      set: (key, next) => once(key, binding => binding.set(next)),
      reset: key => once(key, binding => binding.reset()),
      status: key => once(key, binding => binding.getSnapshot().status),
      subscribe: (key, listener) => {
        const binding = this.bind(caller, key)
        let last = binding.getSnapshot().value
        const unsubscribe = binding.subscribe(() => {
          const next = binding.getSnapshot().value
          if (Object.is(next, last)) return
          last = next
          listener(next)
        })
        let stopped = false
        return () => {
          if (stopped) return
          stopped = true
          unsubscribe()
          binding.release()
        }
      },
    }
  }

  /** The signed-in user changed: the previous user's values are dropped and loaded afresh. */
  resetUser(): void {
    this.user?.reset()
  }

  dispose(): void {
    this.user?.dispose()
    this.browser.dispose()
    this.#writeErrors.clear()
    this.#writeListeners.clear()
    this.#failedWrites.clear()
    this.#writeBindings.clear()
  }

  // -------------------------------------------------------------------------------------------

  #bindUser<T>(
    caller: StorageCaller,
    owner: string,
    instanceId: string | undefined,
    key: AnyStoredKey<T>,
  ): StoredBinding<T> {
    const user = this.user
    const row = instanceId === undefined ? key.name : `${key.name}@${instanceId}`
    if (user === undefined) {
      const error = createStorageError('not-ready', owner, key.name, 'read a user value', {
        expected: 'a user storage adapter on createMfeRuntime({ storage: { user } })',
        observed: 'no adapter',
        repair: 'Give the shell a storage.user adapter, or store this value locally.',
      })
      const snapshot: StoredSnapshot<T> = Object.freeze({
        value: key.defaultValue,
        status: 'error',
        error,
      })
      return {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        set: () => Promise.reject(error),
        reset: () => Promise.reject(error),
        retry: () => Promise.resolve(),
        release: () => {},
      }
    }

    const decodedFor = new WeakMap<StoredValue, Decoded>()
    const decode = (raw: StoredValue): Decoded => {
      let decoded = decodedFor.get(raw)
      if (decoded === undefined) {
        decoded = decodeValue(owner, key, raw)
        decodedFor.set(raw, decoded)
      }
      return decoded
    }
    let lastState: UserRowState | undefined
    let lastSnapshot: StoredSnapshot<T> | undefined
    const getSnapshot = (): StoredSnapshot<T> => {
      const state = user.read(owner, row)
      if (state === lastState && lastSnapshot !== undefined) return lastSnapshot
      lastState = state
      const raw = state.pending !== undefined ? state.pending : state.row
      const decoded: Decoded =
        raw === null || raw === undefined ? { ok: true, value: key.defaultValue } : decode(raw)
      const value = (decoded.ok ? decoded.value : key.defaultValue) as T
      const next: StoredSnapshot<T> =
        state.phase === 'loading'
          ? { value, status: 'loading', error: undefined }
          : state.phase === 'error'
            ? { value, status: 'error', error: state.error }
            : state.pending !== undefined
              ? { value, status: 'saving', error: undefined }
              : state.error !== undefined
                ? { value, status: 'error', error: state.error }
                : decoded.ok
                  ? { value, status: 'ready', error: undefined }
                  : { value, status: 'error', error: decoded.error }
      lastSnapshot =
        lastSnapshot !== undefined &&
        Object.is(lastSnapshot.value, next.value) &&
        lastSnapshot.status === next.status &&
        lastSnapshot.error === next.error
          ? lastSnapshot
          : Object.freeze(next)
      return lastSnapshot
    }

    const write = async (next: StoredUpdate<T> | typeof RESET): Promise<void> => {
      this.#assertWritable(caller, owner, key)
      if (next === RESET) return await user.save(owner, row, null)
      const value = this.#candidate(owner, key, getSnapshot(), next)
      assertJson(owner, key.name, value)
      return await user.save(owner, row, { v: key.version, d: value })
    }

    return {
      getSnapshot,
      subscribe: listener => user.subscribe(owner, row, listener),
      set: next => write(next),
      reset: () => write(RESET),
      retry: () => user.retry(owner, row),
      release: () => {},
    }
  }

  #bindBrowser<T>(
    caller: StorageCaller,
    owner: string,
    instanceId: string | undefined,
    key: AnyStoredKey<T>,
  ): StoredBinding<T> {
    if (key.owner !== undefined)
      throw createStorageError('unauthorized-owner', owner, key.name, 'read a stored value', {
        expected: "storage: 'user' for a value another app owns",
        observed: `storage: '${key.storage}'`,
        repair:
          "Browser storage is private to the app that wrote it; share a value through storage: 'user'.",
      })
    const area = key.storage === 'session' ? 'session' : 'local'
    const declaration = {
      name: key.name,
      storage: area,
      schema: key.schema,
      defaultValue: key.defaultValue,
      version: key.version,
      ...(key.migrate === undefined ? {} : { migrate: key.migrate }),
      ...(instanceId === undefined ? {} : { instanceId }),
    } as const
    const bound: BoundStorageKey<T> =
      owner === HOST_SCOPE
        ? this.browser.bindHost<T>(declaration)
        : this.browser.bind<T>(owner, declaration)
    const writeId = `${area}|${bound.key}`
    this.#writeBindings.set(writeId, (this.#writeBindings.get(writeId) ?? 0) + 1)

    const readErrors = new WeakMap<Error, StorageError>()
    let lastInner: StorageSnapshot<T> | undefined
    let lastWriteError: StorageError | undefined
    let lastSnapshot: StoredSnapshot<T> | undefined
    const getSnapshot = (): StoredSnapshot<T> => {
      const inner = bound.getSnapshot()
      const writeError = this.#writeErrors.get(writeId)
      if (inner === lastInner && writeError === lastWriteError && lastSnapshot !== undefined)
        return lastSnapshot
      lastInner = inner
      lastWriteError = writeError
      if (inner.status === 'error') {
        let error = readErrors.get(inner.error)
        if (error === undefined) {
          error = createStorageError(
            'invalid-value',
            owner,
            key.name,
            `read the ${area} storage key`,
            { observed: inner.error.message, repair: 'Write a new value, or reset() the key.' },
            inner.error,
          )
          readErrors.set(inner.error, error)
        }
        lastSnapshot = Object.freeze({ value: key.defaultValue, status: 'error', error })
      } else if (writeError !== undefined) {
        lastSnapshot = Object.freeze({ value: inner.value, status: 'error', error: writeError })
      } else {
        lastSnapshot = Object.freeze({ value: inner.value, status: 'ready', error: undefined })
      }
      return lastSnapshot
    }

    const write = (apply: () => void): Promise<void> => {
      try {
        apply()
      } catch (cause) {
        // A refused write (read-only key, invalid value, disposed caller) leaves the status as it is.
        if (
          isMfeError(cause) &&
          cause.code.startsWith('storage/') &&
          cause.code !== 'storage/failure'
        )
          return Promise.reject(cause)
        const error = createStorageError(
          'persistence-failed',
          owner,
          key.name,
          `write the ${area} storage key`,
          { observed: describeThrown(cause), repair: 'The stored value is unchanged.' },
          cause,
        )
        this.#setWriteError(writeId, error)
        this.#failedWrites.set(writeId, apply)
        return Promise.reject(error)
      }
      this.#setWriteError(writeId, undefined)
      return Promise.resolve()
    }

    let released = false
    return {
      getSnapshot,
      subscribe: listener => {
        const inner = bound.subscribe(listener)
        const outer = this.#subscribeWrites(writeId, listener)
        return () => {
          inner()
          outer()
        }
      },
      set: next =>
        write(() => {
          this.#assertWritable(caller, owner, key)
          const current = getSnapshot()
          if (typeof next !== 'function') {
            bound.set(this.#candidate(owner, key, current, next))
            return
          }
          this.#assertUpdatable(owner, key, current)
          // The store re-reads the stored value first, so an update made in another tab counts.
          bound.set((stored: T) =>
            this.#candidate(owner, key, { value: stored, status: 'ready', error: undefined }, next),
          )
        }),
      reset: () =>
        write(() => {
          this.#assertWritable(caller, owner, key)
          bound.remove()
        }),
      retry: () => {
        const failed = this.#failedWrites.get(writeId)
        if (failed === undefined) return Promise.resolve()
        return write(failed)
      },
      release: () => {
        if (released) return
        released = true
        bound.release()
        const left = (this.#writeBindings.get(writeId) ?? 1) - 1
        if (left > 0) {
          this.#writeBindings.set(writeId, left)
          return
        }
        this.#writeBindings.delete(writeId)
        this.#failedWrites.delete(writeId)
        this.#writeErrors.delete(writeId)
      },
    }
  }

  /** Resolves a functional update against what this tab reads, then validates the result. */
  #candidate<T>(
    owner: string,
    key: AnyStoredKey<T>,
    current: StoredSnapshot<T>,
    next: StoredUpdate<T>,
  ): T {
    let candidate: unknown = next
    if (typeof next === 'function') {
      this.#assertUpdatable(owner, key, current)
      candidate = (next as (previous: T) => T)(current.value)
    }
    const parsed = key.schema.safeParse(candidate)
    if (!parsed.success)
      throw createStorageError(
        'invalid-value',
        owner,
        key.name,
        'write a stored value',
        {
          expected: `a value matching the key's schema (${describeIssues(parsed.error)})`,
          observed: describeValue(candidate),
          repair: `Fix the value passed to set() for '${key.name}'. The stored value is unchanged.`,
        },
        parsed.error,
      )
    return parsed.data
  }

  #assertWritable(caller: StorageCaller, owner: string, key: AnyStoredKey<unknown>): void {
    if (key.owner !== undefined)
      throw createStorageError('unauthorized-owner', owner, key.name, 'write a stored value', {
        expected: 'a key the writing app declared with storedKey()',
        observed: `a key of '${key.owner}', declared with storedKey.from()`,
        repair: 'Only the owning app writes its values; ask it to expose an action instead.',
      })
    if (caller.signal?.aborted === true)
      throw createStorageError('disposed', owner, key.name, 'write a stored value', {
        observed: 'a write after the mount was disposed',
        repair: 'Stop writing when the mount goes away.',
      })
  }

  #assertUpdatable(
    owner: string,
    key: AnyStoredKey<unknown>,
    current: StoredSnapshot<unknown>,
  ): void {
    if (current.status === 'error' && current.error?.code === 'storage/invalid-value')
      throw createStorageError('invalid-value', owner, key.name, 'update a stored value', {
        expected: 'a readable current value for the update function to apply to',
        observed: current.error.message,
        repair: 'Write an explicit value, or reset() the key first.',
      })
  }

  #setWriteError(id: string, error: StorageError | undefined): void {
    if (error === undefined) this.#failedWrites.delete(id)
    const previous = this.#writeErrors.get(id)
    if (previous === error) return
    if (error === undefined) this.#writeErrors.delete(id)
    else this.#writeErrors.set(id, error)
    for (const listener of [...(this.#writeListeners.get(id) ?? [])]) listener()
  }

  #subscribeWrites(id: string, listener: Listener): Unsubscribe {
    let set = this.#writeListeners.get(id)
    if (set === undefined) {
      set = new Set()
      this.#writeListeners.set(id, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0 && this.#writeListeners.get(id) === set) this.#writeListeners.delete(id)
    }
  }
}

const RESET = Symbol('reset')

/** `AbortSignal.reason` is untyped; the rejection is always an `Error`. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

function describeIssues(error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]
}): string {
  return error.issues
    .map(issue => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
}

/** A stored row is decoded with the reader's own schema, migrating from an older version. */
function decodeValue<T>(owner: string, key: AnyStoredKey<T>, raw: StoredValue): Decoded {
  const fail = (observed: string, repair: string, cause?: unknown): Decoded => ({
    ok: false,
    error: createStorageError(
      'invalid-value',
      owner,
      key.name,
      'read a user value',
      { observed, repair },
      cause,
    ),
  })
  let data = raw.d
  if (raw.v !== key.version) {
    if (raw.v > key.version)
      return fail(
        `a value written at version ${raw.v}, newer than this key's ${key.version}`,
        'Deploy the newer reader, or keep versions in step across apps.',
      )
    if (key.migrate === undefined)
      return fail(
        `a value written at version ${raw.v}`,
        `Add migrate() to '${key.name}' to convert from version ${raw.v}.`,
      )
    try {
      data = key.migrate(raw.d, raw.v)
    } catch (error) {
      return fail(`migrate() threw: ${describeThrown(error)}`, 'Fix migrate().', error)
    }
  }
  const parsed = key.schema.safeParse(data)
  if (!parsed.success)
    return fail(
      describeIssues(parsed.error),
      "The value no longer matches the key's schema; the default is shown until it is written again.",
      parsed.error,
    )
  return { ok: true, value: parsed.data }
}

/** User values travel as JSON, so a `Date` or a cycle is refused before it is sent. */
function assertJson(owner: string, name: string, value: unknown): void {
  const seen = new Set<object>()
  const check = (current: unknown, path: string): void => {
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return
    if (typeof current === 'number' && Number.isFinite(current)) return
    const prototype: unknown =
      current !== null && typeof current === 'object' ? Object.getPrototypeOf(current) : undefined
    const plain = Array.isArray(current) || prototype === Object.prototype || prototype === null
    if (typeof current !== 'object' || !plain || seen.has(current as object))
      throw createStorageError('invalid-value', owner, name, 'write a user value', {
        expected: 'plain JSON data',
        observed: `${path || '<root>'}: ${describeValue(current)}`,
        repair: 'Store strings, numbers, booleans, null, arrays and plain objects only.',
      })
    seen.add(current as object)
    for (const [child, item] of Object.entries(current as object)) check(item, `${path}.${child}`)
    seen.delete(current as object)
  }
  check(value, '')
}
