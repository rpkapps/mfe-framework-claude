/**
 * The `user` area: everything the signed-in user has stored, loaded once through the shell's
 * adapter and held here as raw rows. Decoding against a key's schema happens where the key is
 * bound, so two readers with different schemas can share one row.
 */

import {
  createStorageError,
  describeThrown,
  isMfeError,
  type StorageError,
  type StoredRow,
  type StoredValue,
  type UserStorageAdapter,
  type UserStorageState,
} from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'

export type UserLoadPhase = 'loading' | 'ready' | 'error'

/** One key's raw state; `row` is what the server confirmed, `pending` what this tab is saving. */
export interface UserRowState {
  readonly row: StoredRow | undefined
  /** The value of a save in flight or queued; `null` is a pending removal. */
  readonly pending: StoredValue | null | undefined
  readonly phase: UserLoadPhase
  /** The last failed save of this key, or the failed load. */
  readonly error: StorageError | undefined
}

interface Slot {
  row: StoredRow | undefined
  /** The highest revision this tab has held, kept after a removal so the removed row stays gone. */
  seen: number
  /** Confirmed by a save since the last full state, which may have been read before it landed. */
  savedSinceReplace?: boolean
  /** In flight. */
  sending?: { readonly value: StoredValue | null }
  /** Waiting behind the one in flight; only the latest is kept. */
  queued?: { value: StoredValue | null; readonly waiters: Waiter[] }
  /** Retried as-is by `retry()`. */
  failed?: { readonly value: StoredValue | null; readonly error: StorageError }
  snapshot?: UserRowState
}

interface Waiter {
  resolve(): void
  reject(error: unknown): void
}

export interface UserStorageStoreOptions {
  readonly adapter: UserStorageAdapter
  readonly diagnostics?: DiagnosticsHub
}

const SEPARATOR = '\u0000'

function slotKey(owner: string, key: string): string {
  return `${owner}${SEPARATOR}${key}`
}

function isRow(value: unknown): value is StoredRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Partial<StoredRow>
  return (
    Number.isInteger(row.v) &&
    (row.v as number) > 0 &&
    'd' in row &&
    Number.isSafeInteger(row.revision) &&
    (row.revision as number) >= 0
  )
}

/**
 * Shell-owned, one per document. `reset()` starts over when the signed-in user changes: every
 * request and the adapter's `sync` of the previous user are aborted, and nothing they resolve
 * with is accepted.
 */
export class UserStorageStore {
  readonly #adapter: UserStorageAdapter
  readonly #diagnostics: DiagnosticsHub | undefined
  readonly #slots = new Map<string, Slot>()
  readonly #listeners = new Map<string, Set<() => void>>()
  readonly #anyListeners = new Set<() => void>()
  #phase: UserLoadPhase = 'loading'
  #loadError: StorageError | undefined
  #loaded: Promise<void> = Promise.resolve()
  #controller = new AbortController()
  #generation = 0
  #disposed = false

  constructor(options: UserStorageStoreOptions) {
    this.#adapter = options.adapter
    this.#diagnostics = options.diagnostics
    this.#load()
  }

  get phase(): UserLoadPhase {
    return this.#phase
  }

  /** Why the last load failed, while it stays failed. */
  get loadError(): StorageError | undefined {
    return this.#phase === 'error' ? this.#loadError : undefined
  }

  /**
   * Settles once the current load has; never rejects, since a failed load still mounts apps. A
   * load replaced by `reset()` while awaited is followed to the new one.
   */
  async whenLoaded(): Promise<void> {
    let loading: Promise<void>
    do {
      loading = this.#loaded
      await loading
    } while (loading !== this.#loaded)
  }

  read(owner: string, key: string): UserRowState {
    const slot = this.#slots.get(slotKey(owner, key))
    const error = this.#phase === 'error' ? this.#loadError : (slot?.failed?.error ?? undefined)
    const pending = slot?.queued !== undefined ? slot.queued.value : slot?.sending?.value
    const current = slot?.snapshot
    if (
      current !== undefined &&
      current.row === slot?.row &&
      current.pending === pending &&
      current.phase === this.#phase &&
      current.error === error
    )
      return current
    const next: UserRowState = Object.freeze({ row: slot?.row, pending, phase: this.#phase, error })
    if (slot !== undefined) slot.snapshot = next
    return next
  }

  subscribe(owner: string, key: string, listener: () => void): () => void {
    const id = slotKey(owner, key)
    let set = this.#listeners.get(id)
    if (set === undefined) {
      set = new Set()
      this.#listeners.set(id, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0 && this.#listeners.get(id) === set) this.#listeners.delete(id)
    }
  }

  /** Every change to any key or to the load, for devtools. */
  subscribeAll(listener: () => void): () => void {
    this.#anyListeners.add(listener)
    return () => {
      this.#anyListeners.delete(listener)
    }
  }

  /** Confirmed rows, owner then key, for devtools. */
  entries(): readonly {
    readonly owner: string
    readonly key: string
    readonly state: UserRowState
  }[] {
    return [...this.#slots.keys()].map(id => {
      const [owner = '', key = ''] = id.split(SEPARATOR)
      return { owner, key, state: this.read(owner, key) }
    })
  }

  /**
   * Last write wins per key. A save while another of the same key is in flight waits for it and
   * replaces any save already waiting, so only the latest value goes out next.
   */
  save(owner: string, key: string, value: StoredValue | null): Promise<void> {
    if (this.#disposed)
      return Promise.reject(
        createStorageError('disposed', owner, key, 'save a user value', {
          observed: 'a disposed runtime',
          repair: 'Write through the current runtime.',
        }),
      )
    if (this.#phase !== 'ready')
      return Promise.reject(
        createStorageError('not-ready', owner, key, 'save a user value', {
          expected: "the user's stored values to have loaded",
          observed: this.#phase === 'loading' ? 'a load still in progress' : 'a failed load',
          repair: 'Wait for status "ready", or call retry() after a failed load.',
        }),
      )
    const id = slotKey(owner, key)
    const slot = this.#slot(id)
    delete slot.failed
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject }
      if (slot.sending === undefined) {
        this.#send(owner, key, slot, value, [waiter])
      } else if (slot.queued === undefined) {
        slot.queued = { value, waiters: [waiter] }
      } else {
        slot.queued.value = value
        slot.queued.waiters.push(waiter)
      }
      this.#notify(id)
    })
  }

  /** After a failed load, loads again; after a failed save of this key, sends it again. */
  retry(owner: string, key: string): Promise<void> {
    if (this.#phase === 'error') return this.retryLoad()
    const failed = this.#slots.get(slotKey(owner, key))?.failed
    if (failed === undefined) return Promise.resolve()
    return this.save(owner, key, failed.value)
  }

  /** Loads again after a failed load; does nothing otherwise. */
  retryLoad(): Promise<void> {
    if (this.#phase !== 'error') return Promise.resolve()
    this.#load()
    return this.#loaded
  }

  /**
   * Takes the whole state from the shell. A key with a save in flight keeps this tab's value, and
   * a row older than the one held is ignored, so a late poll never moves a value back.
   */
  replace(state: UserStorageState, generation = this.#generation): void {
    if (this.#disposed || generation !== this.#generation) return
    const incoming = new Map<string, StoredRow>()
    for (const [owner, keys] of Object.entries(state ?? {})) {
      for (const [key, row] of Object.entries(keys ?? {})) {
        if (!isRow(row)) {
          this.#report(
            createStorageError('invalid-value', owner, key, 'accept the user state', {
              expected: 'a row of { v, d, revision }',
              observed: describeThrown(row),
              repair: 'Return rows in the shape load() documents; this row was skipped.',
            }),
          )
          continue
        }
        incoming.set(slotKey(owner, key), row)
      }
    }
    const changed: string[] = []
    for (const [id, row] of incoming) {
      const slot = this.#slot(id)
      slot.savedSinceReplace = false
      // Only the row held at that revision may be re-read, e.g. rewritten at a newer version.
      const rewritten = slot.row?.revision === row.revision && slot.row.v !== row.v
      if (row.revision <= slot.seen && !rewritten) continue
      slot.row = row
      slot.seen = Math.max(slot.seen, row.revision)
      changed.push(id)
    }
    // Absent from a full state means removed, unless this tab is saving it or has just saved it:
    // a state read before that save landed would otherwise remove it again.
    for (const [id, slot] of this.#slots) {
      if (incoming.has(id) || slot.row === undefined) continue
      if (slot.sending !== undefined || slot.queued !== undefined) continue
      if (slot.savedSinceReplace === true) {
        slot.savedSinceReplace = false
        continue
      }
      slot.row = undefined
      changed.push(id)
    }
    for (const id of changed) this.#notify(id)
  }

  /** The signed-in user changed: drop everything of the previous one and load again. */
  reset(): void {
    if (this.#disposed) return
    this.#closeGeneration()
    this.#slots.clear()
    this.#load()
    this.#notifyAll()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#closeGeneration()
    this.#slots.clear()
    this.#notifyAll()
    this.#listeners.clear()
    this.#anyListeners.clear()
  }

  #closeGeneration(): void {
    this.#generation += 1
    this.#controller.abort(
      createStorageError('disposed', '<user>', '<all>', 'keep user storage', {
        observed: 'the signed-in user changed or the runtime was disposed',
      }),
    )
    this.#controller = new AbortController()
    for (const slot of this.#slots.values()) {
      const waiters = slot.queued?.waiters ?? []
      delete slot.queued
      for (const waiter of waiters)
        waiter.reject(
          createStorageError('disposed', '<user>', '<all>', 'save a user value', {
            observed: 'the signed-in user changed before this save was sent',
          }),
        )
    }
  }

  #load(): void {
    const generation = this.#generation
    const signal = this.#controller.signal
    this.#phase = 'loading'
    this.#loadError = undefined
    this.#notifyAll()
    // The executor catches an adapter that throws instead of rejecting.
    const loading = new Promise<UserStorageState>(resolve => {
      resolve(this.#adapter.load(signal))
    })
    // An aborted load may never settle, so whoever awaits it moves on to the next one.
    const aborted = new Promise<void>(resolve => {
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
    const settled = loading
      .then(
        state => {
          if (this.#disposed || generation !== this.#generation) return
          if (state === null || typeof state !== 'object')
            throw new TypeError('load() must resolve with an object of owner → key → row')
          this.#phase = 'ready'
          this.replace(state, generation)
          this.#notifyAll()
          this.#startSync(generation, signal)
        },
        (error: unknown) => {
          if (this.#disposed || generation !== this.#generation) return
          this.#fail(error)
        },
      )
      .catch((error: unknown) => {
        if (this.#disposed || generation !== this.#generation) return
        this.#fail(error)
      })
    this.#loaded = Promise.race([settled, aborted])
  }

  #fail(error: unknown): void {
    this.#phase = 'error'
    this.#loadError = isMfeError(error)
      ? (error as StorageError)
      : createStorageError(
          'persistence-failed',
          '<user>',
          '<all>',
          "load the user's stored values",
          {
            observed: describeThrown(error),
            repair: 'Apps mounted with defaults; call retry() to load again.',
          },
          error,
        )
    this.#report(this.#loadError)
    this.#notifyAll()
  }

  #startSync(generation: number, signal: AbortSignal): void {
    if (this.#adapter.sync === undefined) return
    try {
      this.#adapter.sync(
        {
          replace: state => {
            this.replace(state, generation)
          },
        },
        signal,
      )
    } catch (error) {
      this.#report(
        createStorageError(
          'persistence-failed',
          '<user>',
          '<all>',
          'start syncing user storage',
          { observed: describeThrown(error), repair: 'Fix the adapter’s sync().' },
          error,
        ),
      )
    }
  }

  #send(
    owner: string,
    key: string,
    slot: Slot,
    value: StoredValue | null,
    waiters: readonly Waiter[],
  ): void {
    const generation = this.#generation
    const signal = this.#controller.signal
    slot.sending = { value }
    const replacing = slot.row?.revision ?? -1
    const saving = new Promise<StoredRow | null>(resolve => {
      resolve(this.#adapter.save(owner, key, value, signal))
    })
    void saving
      .then(row => {
        if (this.#disposed || generation !== this.#generation) throw signal.reason
        if (row !== null && !isRow(row))
          throw new TypeError('save() must resolve with the stored row, or null once removed')
        // A newer row another tab wrote while this save was in flight stays.
        if (row === null) {
          if (slot.row !== undefined && slot.row.revision > replacing) return
          slot.row = undefined
        } else {
          if (slot.row !== undefined && slot.row.revision > row.revision) return
          slot.row = row
          slot.seen = Math.max(slot.seen, row.revision)
        }
        slot.savedSinceReplace = true
      })
      .then(
        () => {
          this.#finish(owner, key, slot, generation)
          for (const waiter of waiters) waiter.resolve()
        },
        (cause: unknown) => {
          const error = isMfeError(cause)
            ? (cause as StorageError)
            : createStorageError(
                'persistence-failed',
                owner,
                key,
                'save a user value',
                {
                  observed: describeThrown(cause),
                  repair: 'The value went back to what was stored; call retry() to send it again.',
                },
                cause,
              )
          if (!this.#disposed && generation === this.#generation) {
            slot.failed = { value, error }
            this.#report(error)
          }
          this.#finish(owner, key, slot, generation)
          for (const waiter of waiters) waiter.reject(error)
        },
      )
  }

  #finish(owner: string, key: string, slot: Slot, generation: number): void {
    delete slot.sending
    if (this.#disposed || generation !== this.#generation) return
    const next = slot.queued
    delete slot.queued
    if (next !== undefined) {
      delete slot.failed
      this.#send(owner, key, slot, next.value, next.waiters)
    }
    this.#notify(slotKey(owner, key))
  }

  #slot(id: string): Slot {
    let slot = this.#slots.get(id)
    if (slot === undefined) {
      slot = { row: undefined, seen: -1 }
      this.#slots.set(id, slot)
    }
    return slot
  }

  #notify(id: string): void {
    for (const listener of [...(this.#listeners.get(id) ?? [])]) this.#call(listener)
    for (const listener of [...this.#anyListeners]) this.#call(listener)
  }

  #notifyAll(): void {
    for (const set of [...this.#listeners.values()])
      for (const listener of [...set]) this.#call(listener)
    for (const listener of [...this.#anyListeners]) this.#call(listener)
  }

  #call(listener: () => void): void {
    try {
      listener()
    } catch (error) {
      this.#diagnostics?.report(
        createStorageError(
          'persistence-failed',
          '<user>',
          '<listener>',
          'notify a storage subscriber',
          {
            observed: describeThrown(error),
            repair: 'Fix the subscriber; the others were notified.',
          },
          error,
        ),
        { severity: 'warning' },
      )
    }
  }

  #report(error: StorageError): void {
    this.#diagnostics?.report(error, { severity: 'error' })
  }
}
