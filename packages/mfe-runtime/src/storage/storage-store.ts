/**
 * The framework's single owner of browser storage. A failure is always structured, never a
 * silent fallback to the declared default. A record belongs to the browser profile, not to the
 * signed-in user (§56).
 */

import {
  createMfeError,
  DEFAULT_SCHEMA_VERSION,
  describeThrown,
  describeValue,
  HOST_SCOPE,
  physicalStorageKey,
  toMfeError,
  type Listener,
  type MfeError,
  type BrowserStorageArea,
  type StorageSnapshot,
  type Unsubscribe,
} from '@company/mfe-core'

import type { z } from 'zod'

import type { DiagnosticsHub } from '../diagnostics.ts'
import { KeyedListeners } from '../observable.ts'
import {
  describeIssue,
  readEnvelope,
  serializeEnvelope,
  type Detail,
  type EnvelopeContext,
} from './envelope.ts'

import type {
  BoundStorageKey,
  MfeStorageStoreOptions,
  StorageAreaLike,
  StorageAreaSource,
  StorageEventLike,
  StorageEventTargetLike,
  StorageKeyBinding,
} from './types.ts'

const AREAS = ['local', 'session'] as const
const DEFAULT_AREA: BrowserStorageArea = 'local'

/** Written once: both the read path and the resolve path report it. */
const UNAVAILABLE =
  'Storage is unavailable here — private mode, blocked cookies, or a disabled store. The framework never falls back to memory or to the declared default.'

const NO_VALUE = '<no-value>'
const NO_DEFAULT = '<no-default>'

/** Sorts keys so a re-serialization compares equal to its original. */
function sortKeys(_key: string, entry: unknown): unknown {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry
  const record = entry as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map(key => [key, record[key]]),
  )
}

/** Key-order-independent, so a re-serialization compares equal to its original. */
function stableStringify(value: unknown): string {
  if (value === undefined) return NO_VALUE
  try {
    return JSON.stringify(value, sortKeys) ?? NO_VALUE
  } catch {
    return '<unserializable>'
  }
}

/** Structural, so a re-serialization that changed only key order wakes nobody. */
function snapshotsEquivalent(a: StorageSnapshot<unknown>, b: StorageSnapshot<unknown>): boolean {
  if (a === b) return true
  if (a.status === 'error' || b.status === 'error') {
    return a.status === 'error' && b.status === 'error' && a.error.message === b.error.message
  }
  return a.status === b.status && stableStringify(a.value) === stableStringify(b.value)
}

function entryKeyFor(area: BrowserStorageArea, physicalKey: string): string {
  return `${area}|${physicalKey}`
}

function defaultEventTarget(): StorageEventTargetLike | null {
  const candidate = globalThis as { addEventListener?: unknown; removeEventListener?: unknown }
  return typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
    ? globalThis
    : null
}

interface ResolvedDeclaration {
  readonly name: string
  readonly area: BrowserStorageArea
  readonly instanceId?: string
  readonly schema: z.ZodType
  readonly version: number
  readonly declaresDefault: boolean
  readonly defaultValue: unknown
  readonly defaultSignature: string
  readonly migrate?: (value: unknown, fromVersion: number) => unknown
}

interface KeyEntry {
  readonly entryKey: string
  readonly definitionId: string
  readonly area: BrowserStorageArea
  readonly name: string
  readonly physicalKey: string
  readonly declaration: ResolvedDeclaration
  /** One frozen object per key, so an unchanged "missing" stays reference-equal. */
  readonly defaultSnapshot: StorageSnapshot<unknown>
  bindings: number
  /** False before the first read, and whenever a read threw: `raw` is then a guess. */
  rawKnown: boolean
  raw: string | null
  snapshot: StorageSnapshot<unknown>
  readonly getSnapshot: () => StorageSnapshot<unknown>
  readonly subscribe: (listener: Listener) => Unsubscribe
  readonly set: (next: unknown) => void
  readonly remove: () => void
}

export class MfeStorageStore {
  readonly #areas: { readonly local?: StorageAreaSource; readonly session?: StorageAreaSource }
  readonly #diagnostics: DiagnosticsHub | undefined
  readonly #listeners: KeyedListeners
  readonly #entries = new Map<string, KeyEntry>()
  readonly #eventTarget: StorageEventTargetLike | null
  readonly #nativeListener: (event: Event) => void

  #disposed = false

  constructor(options: MfeStorageStoreOptions = {}) {
    this.#areas = options.areas ?? {}
    this.#diagnostics = options.diagnostics
    this.#listeners = new KeyedListeners(error => {
      this.#warn('notify a storage subscriber', error, {
        expected: 'a subscriber callback that does not throw',
        repair: 'Fix the subscriber; the remaining subscribers were notified regardless.',
      })
    })
    this.#nativeListener = (event: Event) => {
      this.#onNativeStorageEvent(event)
    }
    this.#eventTarget =
      options.eventTarget === undefined ? defaultEventTarget() : options.eventTarget
    this.#eventTarget?.addEventListener('storage', this.#nativeListener)
  }

  bind<T>(
    definitionId: string,
    declaration: StorageKeyBinding<T> & { readonly defaultValue: T },
  ): BoundStorageKey<T>
  bind<T>(definitionId: string, declaration: StorageKeyBinding<T>): BoundStorageKey<T | null>
  bind<T>(definitionId: string, declaration: StorageKeyBinding<T>): BoundStorageKey<T | null> {
    this.#assertDefinitionScope(definitionId, 'bind a storage key')
    return this.#bind(definitionId, declaration)
  }

  /**
   * The same binding in the reserved host scope, for state the page owns rather than any
   * definition on it (§24). There is no mount to hang it off, so `useStoredState` called
   * outside a mount binds here.
   */
  bindHost<T>(declaration: StorageKeyBinding<T> & { readonly defaultValue: T }): BoundStorageKey<T>
  bindHost<T>(declaration: StorageKeyBinding<T>): BoundStorageKey<T | null>
  bindHost<T>(declaration: StorageKeyBinding<T>): BoundStorageKey<T | null> {
    return this.#bind(HOST_SCOPE, declaration)
  }

  #bind<T>(definitionId: string, declaration: StorageKeyBinding<T>): BoundStorageKey<T | null> {
    this.#assertUsable('bind a storage key')
    const resolved = this.#resolveDeclaration(definitionId, declaration)
    const entry = this.#acquireEntry(definitionId, resolved)
    entry.bindings += 1

    let released = false
    const handle: BoundStorageKey<unknown> = {
      key: entry.physicalKey,
      definitionId,
      name: entry.name,
      storage: entry.area,
      version: resolved.version,
      getSnapshot: entry.getSnapshot,
      subscribe: entry.subscribe,
      set: entry.set,
      remove: entry.remove,
      release: () => {
        if (released) return
        released = true
        this.#releaseEntry(entry)
      },
    }
    return handle as unknown as BoundStorageKey<T | null>
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#eventTarget?.removeEventListener('storage', this.#nativeListener)
    this.#listeners.clear()
    this.#entries.clear()
  }

  /**
   * An event for a key nobody is bound to is ignored, and a store-wide clear checks only the
   * active keys.
   */
  handleStorageEvent(event: StorageEventLike): void {
    if (this.#disposed || this.#entries.size === 0) return

    const areas = this.#areasForEvent(event)
    if (areas.length === 0) return

    if (event.key === null) {
      for (const entry of this.#entries.values()) {
        if (areas.includes(entry.area)) this.#refresh(entry)
      }
      return
    }

    const knownArea = event.storageArea !== undefined && event.storageArea !== null
    for (const area of areas) {
      const entry = this.#entries.get(entryKeyFor(area, event.key))
      if (entry === undefined) continue
      // Trust the payload only when the event named a store we own, so an event of
      // unknown provenance cannot invent a value.
      if (knownArea) this.#applyRaw(entry, event.newValue)
      else this.#refresh(entry)
    }
  }

  #onNativeStorageEvent(event: Event): void {
    const candidate = event as unknown as Partial<StorageEventLike>
    if (!('key' in candidate) || !('newValue' in candidate)) return
    this.handleStorageEvent({
      key: candidate.key ?? null,
      newValue: candidate.newValue ?? null,
      storageArea: candidate.storageArea,
    })
  }

  #areasForEvent(event: StorageEventLike): readonly BrowserStorageArea[] {
    if (event.storageArea === undefined || event.storageArea === null) return AREAS
    for (const area of AREAS) {
      try {
        if (this.#resolveArea(area) === event.storageArea) return [area]
      } catch {
        continue
      }
    }
    return []
  }

  #resolveDeclaration<T>(
    definitionId: string,
    declaration: StorageKeyBinding<T>,
  ): ResolvedDeclaration {
    const area = declaration.storage ?? DEFAULT_AREA
    const name = declaration.name

    if (typeof name !== 'string' || name.length === 0) {
      throw this.#fail(definitionId, area, 'bind', String(name), {
        expected: 'a non-empty storage key name',
        observed: describeValue(name),
        repair: "Give the key a stable name, e.g. bind(id, { name: 'filters', schema }).",
      })
    }
    const instanceId = this.#resolveInstance(definitionId, area, declaration.instanceId, name)

    const version = declaration.version ?? DEFAULT_SCHEMA_VERSION
    if (!Number.isInteger(version) || version < 1) {
      throw this.#fail(definitionId, area, 'bind', name, {
        expected: 'an integer schema version of 1 or more',
        observed: describeValue(declaration.version),
        repair: 'Start at 1 and raise it whenever the persisted shape changes, adding migrate().',
      })
    }

    let declaresDefault = false
    let defaultValue: unknown = null
    if (declaration.defaultValue !== undefined) {
      const result = declaration.schema.safeParse(declaration.defaultValue)
      if (!result.success) {
        throw this.#fail(definitionId, area, 'bind', name, {
          expected: `a default matching the declared schema (${describeIssue(result.error)})`,
          observed: describeValue(declaration.defaultValue),
          repair: 'Fix defaultValue; it is validated where it is declared, not on first use.',
          cause: result.error,
        })
      }
      declaresDefault = true
      defaultValue = result.data
    }

    return {
      name,
      area,
      ...(instanceId === undefined ? {} : { instanceId }),
      schema: declaration.schema,
      version,
      declaresDefault,
      defaultValue,
      defaultSignature: declaresDefault ? stableStringify(defaultValue) : NO_DEFAULT,
      ...(declaration.migrate === undefined ? {} : { migrate: declaration.migrate }),
    }
  }

  #acquireEntry(definitionId: string, declaration: ResolvedDeclaration): KeyEntry {
    const physicalKey = physicalStorageKey(definitionId, declaration.name, declaration.instanceId)
    const entryKey = entryKeyFor(declaration.area, physicalKey)
    const existing = this.#entries.get(entryKey)
    if (existing !== undefined) {
      this.#assertCompatible(existing, declaration)
      return existing
    }
    const entry = this.#createEntry(definitionId, declaration, entryKey, physicalKey)
    this.#entries.set(entryKey, entry)
    // The one read per key. Everything after is served from the cached snapshot.
    this.#refresh(entry)
    return entry
  }

  #createEntry(
    definitionId: string,
    declaration: ResolvedDeclaration,
    entryKey: string,
    physicalKey: string,
  ): KeyEntry {
    const defaultSnapshot: StorageSnapshot<unknown> = Object.freeze({
      status: 'default' as const,
      value: declaration.declaresDefault ? declaration.defaultValue : null,
    })

    const entry: KeyEntry = {
      entryKey,
      definitionId,
      area: declaration.area,
      name: declaration.name,
      physicalKey,
      declaration,
      defaultSnapshot,
      bindings: 0,
      rawKnown: false,
      raw: null,
      snapshot: defaultSnapshot,
      getSnapshot: () => entry.snapshot,
      subscribe: (listener: Listener) => {
        const unsubscribe = this.#listeners.subscribe(entryKey, listener)
        return () => {
          unsubscribe()
          this.#evictIfUnused(entry)
        }
      },
      set: (next: unknown) => {
        this.#setValue(entry, next)
      },
      remove: () => {
        this.#removeValue(entry)
      },
    }
    return entry
  }

  /**
   * A disagreement is reported to the consumer that disagrees, not resolved in favour of whoever
   * rendered first.
   */
  #assertCompatible(entry: KeyEntry, incoming: ResolvedDeclaration): void {
    const active = entry.declaration
    const shownDefault = (declaration: ResolvedDeclaration): string =>
      declaration.declaresDefault
        ? `the default ${stableStringify(declaration.defaultValue)}`
        : 'no declared default'

    if (active.schema !== incoming.schema) {
      this.#incompatible(
        entry,
        'schema',
        'the same schema object every active consumer already declared',
        'a different schema object',
      )
    }
    if (active.version !== incoming.version) {
      this.#incompatible(
        entry,
        'version',
        `version ${active.version}`,
        `version ${incoming.version}`,
      )
    }
    if (active.defaultSignature !== incoming.defaultSignature) {
      this.#incompatible(entry, 'defaultValue', shownDefault(active), shownDefault(incoming))
    }
  }

  #incompatible(entry: KeyEntry, field: string, expected: string, observed: string): never {
    throw this.#fail(entry.definitionId, entry.area, 'bind', entry.name, {
      expected,
      observed,
      repair: `Declare '${entry.physicalKey}' in one shared module so every consumer agrees on ${field}.`,
    })
  }

  #releaseEntry(entry: KeyEntry): void {
    entry.bindings -= 1
    this.#evictIfUnused(entry)
  }

  /**
   * Whichever of the last release and the last unsubscribe comes second drops the entry, so a
   * later consumer may declare the key afresh. Only this entry: an unsubscribe that outlived it
   * must not drop a newer one bound under the same key.
   */
  #evictIfUnused(entry: KeyEntry): void {
    if (entry.bindings > 0) return
    if (this.#listeners.listenerCount(entry.entryKey) > 0) return
    if (this.#entries.get(entry.entryKey) === entry) this.#entries.delete(entry.entryKey)
  }

  #invalidateCache(entry: KeyEntry): void {
    entry.rawKnown = false
    entry.raw = null
  }

  #refresh(entry: KeyEntry): void {
    let raw: string | null
    try {
      raw = this.#resolveArea(entry.area).getItem(entry.physicalKey)
    } catch (error) {
      this.#invalidateCache(entry)
      this.#publish(
        entry,
        this.#errorSnapshot(entry, 'read', {
          expected: `${entry.area} storage to be readable`,
          observed: describeThrown(error),
          repair: UNAVAILABLE,
          cause: error,
        }),
      )
      return
    }
    this.#applyRaw(entry, raw)
  }

  /** The only place a stored representation becomes a snapshot. */
  #applyRaw(entry: KeyEntry, raw: string | null): void {
    if (entry.rawKnown && entry.raw === raw) return
    const outcome = readEnvelope(this.#envelopeContext(entry), raw)
    entry.raw = outcome.raw
    entry.rawKnown = true
    this.#publish(entry, outcome.snapshot)
  }

  #publish(entry: KeyEntry, snapshot: StorageSnapshot<unknown>): void {
    if (snapshotsEquivalent(entry.snapshot, snapshot)) return
    entry.snapshot = snapshot
    this.#listeners.notify(entry.entryKey)
  }

  #setValue(entry: KeyEntry, next: unknown): void {
    this.#assertUsable('write a storage key')

    let candidate = next
    if (typeof next === 'function') {
      // A functional update resolves against the latest stored value, not against whatever
      // this document last rendered.
      this.#refresh(entry)
      const snapshot = entry.snapshot
      if (snapshot.status === 'error') {
        throw this.#fail(entry.definitionId, entry.area, 'write', entry.name, {
          expected: 'a readable current value for the functional update to apply to',
          observed: `an unreadable record (${snapshot.error.message})`,
          repair: `Write an explicit value to '${entry.name}', or remove the key first: a functional update has no valid base while the stored record is unreadable.`,
          cause: snapshot.error,
        })
      }
      const current =
        snapshot.status === 'default' && !entry.declaration.declaresDefault ? null : snapshot.value
      candidate = (next as (value: unknown) => unknown)(current)
    }

    const result = entry.declaration.schema.safeParse(candidate)
    if (!result.success) {
      throw this.#fail(entry.definitionId, entry.area, 'write', entry.name, {
        expected: `a value matching the declared schema (${describeIssue(result.error)})`,
        observed: describeValue(candidate),
        repair: `Fix the value passed to set() for '${entry.name}'. The stored value is unchanged.`,
        cause: result.error,
      })
    }

    const serialized = serializeEnvelope(entry.declaration, result.data, (verb, detail) =>
      this.#fail(entry.definitionId, entry.area, verb, entry.name, detail),
    )
    this.#writeRaw(entry, serialized, 'write')
    entry.raw = serialized
    entry.rawKnown = true
    this.#publish(entry, { status: 'value', value: result.data })
  }

  #removeValue(entry: KeyEntry): void {
    this.#assertUsable('remove a storage key')
    this.#removeRaw(entry.definitionId, entry.area, entry.name, entry.physicalKey)
    entry.raw = null
    entry.rawKnown = true
    this.#publish(entry, entry.defaultSnapshot)
  }

  #removeRaw(
    definitionId: string,
    area: BrowserStorageArea,
    name: string,
    physicalKey: string,
  ): void {
    const store = this.#resolveAreaOrFail(definitionId, area, 'remove', name)
    try {
      store.removeItem(physicalKey)
    } catch (error) {
      throw this.#fail(definitionId, area, 'remove', name, {
        expected: `to remove '${physicalKey}'`,
        observed: describeThrown(error),
        repair: 'Retry the removal; the stored value is unchanged.',
        cause: error,
      })
    }
  }

  #writeRaw(entry: KeyEntry, serialized: string, verb: string): void {
    const store = this.#resolveAreaOrFail(entry.definitionId, entry.area, verb, entry.name)
    try {
      store.setItem(entry.physicalKey, serialized)
    } catch (error) {
      throw this.#fail(entry.definitionId, entry.area, verb, entry.name, {
        expected: `${entry.area} storage to accept ${serialized.length} characters`,
        observed: describeThrown(error),
        repair:
          'The store is full or blocked. Persist less, or free space in this browser. The stored value is unchanged.',
        cause: error,
      })
    }
  }

  #resolveArea(area: BrowserStorageArea): StorageAreaLike {
    const source = area === 'local' ? this.#areas.local : this.#areas.session
    if (typeof source === 'function') return source()
    if (source !== undefined) return source
    // Property access itself can throw in a locked-down browsing context.
    const holder = globalThis as {
      localStorage?: StorageAreaLike
      sessionStorage?: StorageAreaLike
    }
    const resolved = area === 'local' ? holder.localStorage : holder.sessionStorage
    if (resolved === undefined || resolved === null) {
      throw new Error(`${area}Storage is not available in this context`)
    }
    return resolved
  }

  #resolveAreaOrFail(
    definitionId: string,
    area: BrowserStorageArea,
    verb: string,
    name: string,
  ): StorageAreaLike {
    try {
      return this.#resolveArea(area)
    } catch (error) {
      throw this.#fail(definitionId, area, verb, name, {
        expected: `${area} storage to be available`,
        observed: describeThrown(error),
        repair: UNAVAILABLE,
        cause: error,
      })
    }
  }

  #envelopeContext(entry: KeyEntry): EnvelopeContext {
    return {
      declaration: entry.declaration,
      physicalKey: entry.physicalKey,
      area: entry.area,
      defaultSnapshot: entry.defaultSnapshot,
      fail: (verb, detail) => this.#fail(entry.definitionId, entry.area, verb, entry.name, detail),
      write: serialized => {
        this.#writeRaw(entry, serialized, 'migrate')
      },
    }
  }

  #errorSnapshot(entry: KeyEntry, verb: string, detail: Detail): StorageSnapshot<unknown> {
    return {
      status: 'error',
      error: this.#fail(entry.definitionId, entry.area, verb, entry.name, detail),
    }
  }

  #fail(
    definitionId: string,
    area: BrowserStorageArea,
    verb: string,
    name: string,
    detail: Detail,
  ): MfeError {
    const error = createMfeError({
      ...detail,
      code: 'storage/failure',
      id: definitionId,
      operation: `${verb} the ${area} storage key`,
      path: [name],
    })
    this.#diagnostics?.report(error, {
      severity: 'error',
      context: { definitionId, area, key: name },
    })
    return error
  }

  /**
   * A failure of the store itself is named by the reserved host scope rather than a made-up
   * `'shell'`, which a definition could also be called (§24).
   */
  #failStore(operation: string, detail: Detail): MfeError {
    const error = createMfeError({ ...detail, code: 'storage/failure', id: HOST_SCOPE, operation })
    this.#diagnostics?.report(error, { severity: 'error', context: { operation } })
    return error
  }

  #warn(operation: string, cause: unknown, detail: Detail): void {
    this.#diagnostics?.report(
      toMfeError(cause, { ...detail, code: 'storage/failure', id: HOST_SCOPE, operation }),
      { severity: 'warning', context: { operation } },
    )
  }

  /**
   * One way in, so "this record belongs to the page" is declared at the call site instead of
   * inferred from an id somebody chose (§24).
   */
  #assertDefinitionScope(definitionId: string, operation: string): void {
    if (definitionId !== HOST_SCOPE) {
      if (
        typeof definitionId === 'string' &&
        definitionId.length > 0 &&
        !definitionId.includes(':')
      )
        return
      throw this.#failStore(operation, {
        expected: 'a non-empty definition id without a colon',
        observed: describeValue(definitionId),
        repair: 'Use the registry definition id; invalid prefixes could touch unrelated records.',
      })
    }
    throw this.#failStore(operation, {
      expected: 'a definition id',
      observed: `the reserved host scope '${HOST_SCOPE}'`,
      repair:
        'Use bindHost() for state the host page owns; it reaches the same scope deliberately.',
    })
  }

  #assertUsable(operation: string): void {
    if (!this.#disposed) return
    throw this.#failStore(operation, {
      expected: 'a live storage store',
      observed: 'a store that was already disposed',
      repair: 'Create a new MfeStorageStore; a disposed one no longer observes storage events.',
    })
  }

  #resolveInstance(
    definitionId: string,
    area: BrowserStorageArea,
    instanceId: string | undefined,
    name: string,
  ): string | undefined {
    if (instanceId === undefined) return undefined
    if (
      definitionId === HOST_SCOPE ||
      typeof instanceId !== 'string' ||
      instanceId.trim().length === 0
    ) {
      throw this.#fail(definitionId, area, 'bind', name, {
        expected: 'a stable non-empty instanceId supplied by the host that placed the app',
        observed:
          definitionId === HOST_SCOPE
            ? `an instanceId in the host scope`
            : describeValue(instanceId),
        repair:
          'Pass instanceId where the host places the widget and keep it across remounts; the host page itself has no instances.',
      })
    }
    return instanceId
  }
}
