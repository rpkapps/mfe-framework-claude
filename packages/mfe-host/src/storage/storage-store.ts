/**
 * The framework's single owner of browser storage: validated reads and writes,
 * key scoping, retention, session generations and migration.
 *
 * Three decisions shape everything below.
 *
 * 1. A failure is a failure. Unavailable storage, malformed JSON, a schema
 *    mismatch, a quota error and a browser access error all surface as a
 *    structured `storage/failure`. There is no silent switch to another store,
 *    no in-memory fallback, and the declared default never stands in for a
 *    value that exists but could not be read - otherwise a corrupt record looks
 *    exactly like a first visit.
 *
 * 2. Parse once per key, not once per subscriber. Each active `<id>:<key>` in
 *    one store keeps the raw serialized string it last saw and the immutable
 *    snapshot parsed from it. `getSnapshot` returns that snapshot and touches
 *    neither `JSON` nor the browser store, so the cost of a key does not grow
 *    with the number of subscribers or renders.
 *
 * 3. The generation is the fence. Session-retained records carry the opaque
 *    session generation they were written in. A record from another generation
 *    is treated as absent on read, so a failed physical delete, a late
 *    cross-tab write and an in-flight handler that resolves after a logout
 *    cannot resurrect a retired session's data.
 */

import {
  createMfeError,
  DEFAULT_RETENTION,
  DEFAULT_SCHEMA_VERSION,
  describeValue,
  isStorageEnvelope,
  KeyedListeners,
  physicalStorageKey,
  storagePrefix,
  toMfeError,
  type ContractSchema,
  type DiagnosticsHub,
  type Listener,
  type MfeError,
  type MfeErrorDetails,
  type MfeStorage,
  type MfeStorageKey,
  type StorageArea,
  type StorageEnvelope,
  type StorageKeyOptions,
  type StorageRetention,
  type StorageSnapshot,
  type Unsubscribe,
} from '@company/mfe-core'

import type {
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
  StorageStoreStats,
  StorageWriteOptions,
} from './types.ts'

const AREAS = ['local', 'session'] as const

/** `<id>:<name>` with a colon-free id, so prefix ownership is unambiguous. */
const FRAMEWORK_KEY_PATTERN = /^[^:]+:.+$/

const DEFAULT_AREA: StorageArea = 'local'

/** Sentinels that no JSON text can collide with. */
const NO_VALUE = '<no-value>'
const NO_DEFAULT = '<no-default>'
const UNSERIALIZABLE = '<unserializable>'

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Key-order-independent serialization, used to compare declared defaults and values. */
function stableStringify(value: unknown): string {
  if (value === undefined) return NO_VALUE
  try {
    return (
      JSON.stringify(value, (_key, entry: unknown) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry
        const record = entry as Record<string, unknown>
        const sorted: Record<string, unknown> = {}
        for (const key of Object.keys(record).sort()) sorted[key] = record[key]
        return sorted
      }) ?? NO_VALUE
    )
  } catch {
    return UNSERIALIZABLE
  }
}

/**
 * Snapshots are compared structurally, so a re-serialization that changed only
 * key order keeps the previous snapshot reference and subscribers are not woken
 * for a value they already hold.
 */
function snapshotsEquivalent(a: StorageSnapshot<unknown>, b: StorageSnapshot<unknown>): boolean {
  if (a === b) return true
  if (a.status === 'error' || b.status === 'error') {
    if (a.status !== 'error' || b.status !== 'error') return false
    return a.error.message === b.error.message
  }
  if (a.status !== b.status) return false
  return stableStringify(a.value) === stableStringify(b.value)
}

/** A group set is a set: order and duplicates carry no meaning. */
function canonicalGroups(groups: readonly string[]): string {
  return JSON.stringify([...new Set(groups)].sort())
}

function entryKeyFor(area: StorageArea, physicalKey: string): string {
  return `${area}|${physicalKey}`
}

function defaultEventTarget(): StorageEventTargetLike | null {
  const candidate = globalThis as { addEventListener?: unknown; removeEventListener?: unknown }
  return typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
    ? (globalThis as unknown as StorageEventTargetLike)
    : null
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : describeValue(error)
}

/* -------------------------------------------------------------------------- */
/* Internal state                                                              */
/* -------------------------------------------------------------------------- */

interface ResolvedDeclaration {
  readonly name: string
  readonly area: StorageArea
  readonly schema: ContractSchema<unknown>
  readonly retention: StorageRetention
  readonly version: number
  readonly declaresDefault: boolean
  readonly defaultValue: unknown
  readonly defaultSignature: string
  readonly migrate?: (value: unknown, fromVersion: number) => unknown
}

interface KeyEntry {
  readonly entryKey: string
  readonly definitionId: string
  readonly area: StorageArea
  readonly name: string
  readonly physicalKey: string
  readonly declaration: ResolvedDeclaration
  /** One frozen object per key, so an unchanged "missing" stays reference-equal. */
  readonly defaultSnapshot: StorageSnapshot<unknown>
  bindings: number
  loaded: boolean
  /** False when the last read threw, so no raw string can be mistaken for the truth. */
  rawKnown: boolean
  raw: string | null
  snapshot: StorageSnapshot<unknown>
  readonly getSnapshot: () => StorageSnapshot<unknown>
  readonly subscribe: (listener: Listener) => Unsubscribe
  readonly read: () => unknown
  readonly set: (next: unknown, options?: StorageWriteOptions) => void
  readonly remove: (options?: StorageWriteOptions) => void
}

interface ParseOutcome {
  readonly snapshot: StorageSnapshot<unknown>
  /** The raw string that now represents the stored state; a migration rewrites it. */
  readonly raw: string | null
}

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

export class MfeStorageStore {
  readonly #areas: {
    readonly local?: StorageAreaSource
    readonly session?: StorageAreaSource
  }
  readonly #diagnostics: DiagnosticsHub | undefined
  readonly #listeners: KeyedListeners
  readonly #entries = new Map<string, KeyEntry>()
  /** Every generation this store has ever been given; a generation is never reused. */
  readonly #seenGenerations = new Set<string>()
  readonly #eventTarget: StorageEventTargetLike | null
  readonly #nativeListener: (event: Event) => void

  #generation: string | null
  #groups: string | null
  #disposed = false
  #reads = 0
  #parses = 0
  #writes = 0

  constructor(options: MfeStorageStoreOptions = {}) {
    this.#areas = options.areas ?? {}
    this.#diagnostics = options.diagnostics
    this.#generation = options.sessionGeneration ?? null
    if (this.#generation !== null) this.#seenGenerations.add(this.#generation)
    this.#groups = options.groups === undefined ? null : canonicalGroups(options.groups)
    this.#listeners = new KeyedListeners(error => {
      this.#reportListenerError(error)
    })
    this.#nativeListener = (event: Event) => {
      this.#onNativeStorageEvent(event)
    }
    this.#eventTarget =
      options.eventTarget === undefined ? defaultEventTarget() : options.eventTarget
    this.#eventTarget?.addEventListener('storage', this.#nativeListener)
  }

  /* ---------------------------------------------------------------------- */
  /* Session generation                                                      */
  /* ---------------------------------------------------------------------- */

  get sessionGeneration(): string | null {
    return this.#generation
  }

  /** True once a generation the shell supplied is in force. */
  get hasSession(): boolean {
    return this.#generation !== null
  }

  /**
   * Establishes the first generation of a continuous session. Rotating an
   * existing generation goes through `applySessionTransition`, which also
   * invalidates the session records the old generation left behind.
   */
  establishSession(generation: string): void {
    this.#assertUsable('establish the session generation')
    if (this.#generation === generation) return
    if (this.#generation !== null) {
      throw this.#failSession('establish the session generation', {
        expected: `no session generation, or the one already in force ('${this.#generation}')`,
        observed: `a different generation ('${generation}')`,
        declaredBy: 'The framework storage boundary',
        repair:
          'Call applySessionTransition(transition, nextGeneration) to rotate a generation, so the records of the retired session are invalidated first.',
      })
    }
    this.#assertFreshGeneration(generation, 'establish the session generation')
    this.#seenGenerations.add(generation)
    this.#generation = generation
    // A session-retained record means something different now, even though its
    // serialized text has not changed, so its cached reading is dropped.
    for (const entry of this.#entries.values()) {
      if (entry.declaration.retention !== 'session') continue
      this.#invalidateCache(entry)
      this.#refresh(entry, true)
    }
  }

  #invalidateCache(entry: KeyEntry): void {
    entry.loaded = false
    entry.rawKnown = false
    entry.raw = null
  }

  /**
   * Applies a shell transition.
   *
   * Theme and token refresh invalidate nothing. A reordered but otherwise
   * identical group set is a no-op. An identity change or a semantic group
   * change retires the in-memory snapshots first, then invalidates persisted
   * session records - including those of definitions that are not currently
   * mounted - then publishes the declared defaults to whoever is still
   * subscribed. Preference records survive untouched.
   */
  applySessionTransition(
    transition: StorageSessionTransition,
    nextGeneration?: string,
  ): SessionTransitionResult {
    this.#assertUsable('apply a session transition')

    const outcome = this.#classifyTransition(transition)
    if (outcome !== 'invalidated') {
      this.#rememberGroups(transition)
      return {
        outcome,
        invalidated: false,
        generation: this.#generation,
        removedRecords: 0,
        notifiedKeys: 0,
      }
    }

    if (nextGeneration === undefined || nextGeneration === '') {
      throw this.#failSession('apply a session transition', {
        expected: 'a fresh opaque session generation for the new session',
        observed: nextGeneration === '' ? 'an empty string' : 'nothing',
        declaredBy: 'The shell, which owns session identity',
        repair:
          'Pass a new opaque generation string - never a token and never a group list - as the second argument of applySessionTransition.',
      })
    }
    this.#assertFreshGeneration(nextGeneration, 'apply a session transition')

    // 1. Retire the in-memory session snapshots before any new-session state exists.
    const stale = new Map<KeyEntry, StorageSnapshot<unknown>>()
    for (const entry of this.#entries.values()) {
      if (entry.declaration.retention !== 'session') continue
      stale.set(entry, entry.snapshot)
      entry.snapshot = entry.defaultSnapshot
      this.#invalidateCache(entry)
    }

    // 2. Rotate the generation, then drop the persisted session records everywhere.
    this.#seenGenerations.add(nextGeneration)
    this.#generation = nextGeneration
    this.#rememberGroups(transition)
    const removedRecords = this.#purgeSessionRecords()

    // 3. Publish the reset values to whoever is still subscribed.
    let notifiedKeys = 0
    for (const [entry, previousSnapshot] of stale) {
      this.#refresh(entry, true)
      if (snapshotsEquivalent(previousSnapshot, entry.snapshot)) continue
      notifiedKeys += 1
      this.#listeners.notify(entry.entryKey)
    }

    return {
      outcome: 'invalidated',
      invalidated: true,
      generation: nextGeneration,
      removedRecords,
      notifiedKeys,
    }
  }

  #classifyTransition(transition: StorageSessionTransition): SessionTransitionOutcome {
    switch (transition.kind) {
      case 'theme':
      case 'token-refresh':
        return 'not-session-affecting'
      case 'identity':
        return 'invalidated'
      case 'groups': {
        if (transition.groups === undefined) return 'invalidated'
        const canonical = canonicalGroups(transition.groups)
        return this.#groups !== null && canonical === this.#groups
          ? 'unchanged-group-set'
          : 'invalidated'
      }
    }
  }

  #rememberGroups(transition: StorageSessionTransition): void {
    if (transition.kind !== 'groups' && transition.kind !== 'identity') return
    this.#groups = transition.groups === undefined ? null : canonicalGroups(transition.groups)
  }

  #assertFreshGeneration(generation: string, operation: string): void {
    if (!this.#seenGenerations.has(generation)) return
    throw this.#failSession(operation, {
      expected: 'a generation this store has never seen before',
      observed: `the already-used generation '${generation}'`,
      declaredBy: 'The framework storage boundary',
      repair:
        'Mint a new opaque generation for every session. Returning to an earlier user or group configuration starts a new session; reusing that configuration’s previous generation would make its invalidated records readable again.',
    })
  }

  /**
   * Removes every framework record marked `r: 'session'` from both stores,
   * including keys of definitions that are not mounted. Records that are not
   * framework envelopes, and preference records, are left exactly as they are:
   * this store never removes anything it did not write.
   */
  #purgeSessionRecords(): number {
    let removed = 0
    for (const area of AREAS) {
      let store: StorageAreaLike
      try {
        store = this.#resolveArea(area)
      } catch (error) {
        this.#reportAreaFailure(area, 'invalidate session records', error)
        continue
      }

      let names: readonly string[]
      try {
        names = this.#listKeys(store)
      } catch (error) {
        this.#reportAreaFailure(area, 'invalidate session records', error)
        continue
      }

      for (const name of names) {
        if (!FRAMEWORK_KEY_PATTERN.test(name)) continue
        let raw: string | null
        try {
          this.#reads += 1
          raw = store.getItem(name)
        } catch (error) {
          this.#reportAreaFailure(area, 'invalidate session records', error)
          continue
        }
        if (raw === null) continue

        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          // Not a framework record, so the framework does not own it.
          continue
        }
        if (!isStorageEnvelope(parsed) || parsed.r !== 'session') continue

        try {
          store.removeItem(name)
          removed += 1
        } catch (error) {
          // Generation validation still prevents the record from being used.
          this.#reportAreaFailure(area, 'invalidate session records', error)
        }
      }
    }
    return removed
  }

  /* ---------------------------------------------------------------------- */
  /* Binding                                                                 */
  /* ---------------------------------------------------------------------- */

  bind<T>(
    definitionId: string,
    declaration: StorageKeyBinding<T> & { readonly defaultValue: T },
  ): BoundStorageKey<T>
  bind<T>(definitionId: string, declaration: StorageKeyBinding<T>): BoundStorageKey<T | null>
  bind<T>(definitionId: string, declaration: StorageKeyBinding<T>): BoundStorageKey<T | null> {
    this.#assertUsable('bind a storage key')
    const resolved = this.#resolveDeclaration(definitionId, declaration)
    const entry = this.#acquireEntry(definitionId, resolved)
    entry.bindings += 1

    let released = false
    const handle: BoundStorageKey<unknown> = {
      key: entry.physicalKey,
      definitionId,
      name: entry.name,
      area: entry.area,
      retention: resolved.retention,
      version: resolved.version,
      getSnapshot: entry.getSnapshot,
      subscribe: entry.subscribe,
      read: entry.read,
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

  /**
   * The imperative surface for non-React and tier-2 consumers. A write through
   * it notifies the reactive subscribers of the same key.
   */
  storageFor(definitionId: string, area: StorageArea = DEFAULT_AREA): MfeStorage {
    return {
      key: <T>(
        name: string,
        schema: ContractSchema<T>,
        options?: StorageKeyOptions<T>,
      ): MfeStorageKey<T> => this.#imperativeKey(definitionId, area, name, schema, options),
      remove: (name: string): void => {
        this.#imperativeRemove(definitionId, area, name)
      },
      clear: (): void => {
        this.clearDefinition(definitionId, area)
      },
    }
  }

  /**
   * Removes every key under the exact `<id>:` prefix, for every mount of that
   * definition. `acme-orders` never touches `acme-orders-legacy:`, the shell's
   * own keys, or a third party's.
   */
  clearDefinition(definitionId: string, area?: StorageArea): number {
    this.#assertUsable('clear storage')
    const areas = area === undefined ? AREAS : [area]
    const prefix = storagePrefix(definitionId)
    let removed = 0

    for (const target of areas) {
      try {
        const store = this.#resolveAreaOrFail(definitionId, target, 'clear', null)
        let names: readonly string[]
        try {
          names = this.#listKeys(store).filter(name => name.startsWith(prefix))
        } catch (error) {
          throw this.#error(definitionId, target, 'clear', null, {
            expected: `to enumerate ${target} storage and find the keys under '${prefix}'`,
            observed: describeThrown(error),
            declaredBy: 'The framework storage boundary',
            repair:
              'Browser storage is not readable in this context. Handle the failure; the framework never clears a store it cannot enumerate.',
            cause: error,
          })
        }

        for (const name of names) {
          try {
            store.removeItem(name)
            removed += 1
          } catch (error) {
            throw this.#error(definitionId, target, 'clear', null, {
              expected: `to remove '${name}'`,
              observed: describeThrown(error),
              declaredBy: 'The framework storage boundary',
              repair: `Retry the clear. Keys under '${prefix}' that were already removed stay removed, and no key outside that prefix was touched.`,
              cause: error,
            })
          }
        }
      } finally {
        for (const entry of this.#entries.values()) {
          if (entry.area !== target || entry.definitionId !== definitionId) continue
          this.#refresh(entry, true)
        }
      }
    }
    return removed
  }

  /* ---------------------------------------------------------------------- */
  /* Introspection for the performance gates                                 */
  /* ---------------------------------------------------------------------- */

  stats(): StorageStoreStats {
    let bindings = 0
    let subscribers = 0
    for (const entry of this.#entries.values()) {
      bindings += entry.bindings
      subscribers += this.#listeners.listenerCount(entry.entryKey)
    }
    return {
      activeKeys: this.#entries.size,
      bindings,
      subscribers,
      reads: this.#reads,
      parses: this.#parses,
      writes: this.#writes,
    }
  }

  /** Entry keys, `<area>|<id>:<name>`, that are currently active. */
  activeKeys(): readonly string[] {
    return [...this.#entries.keys()]
  }

  subscriberCount(definitionId: string, name: string, area: StorageArea = DEFAULT_AREA): number {
    return this.#listeners.listenerCount(entryKeyFor(area, physicalStorageKey(definitionId, name)))
  }

  bindingCount(definitionId: string, name: string, area: StorageArea = DEFAULT_AREA): number {
    return (
      this.#entries.get(entryKeyFor(area, physicalStorageKey(definitionId, name)))?.bindings ?? 0
    )
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#eventTarget?.removeEventListener('storage', this.#nativeListener)
    this.#listeners.clear()
    this.#entries.clear()
  }

  /* ---------------------------------------------------------------------- */
  /* Cross-tab storage events                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Applies a native `storage` event from another tab of the same origin. An
   * event for a key nobody is bound to is ignored, and a store-wide clear
   * (`key === null`) checks only the active keys of that store rather than
   * re-reading everything.
   */
  handleStorageEvent(event: StorageEventLike): void {
    if (this.#disposed || this.#entries.size === 0) return

    const areas = this.#areasForEvent(event)
    if (areas.length === 0) return

    if (event.key === null) {
      for (const area of areas) {
        for (const entry of this.#entries.values()) {
          if (entry.area === area) this.#refresh(entry, true)
        }
      }
      return
    }

    const knownArea = event.storageArea !== undefined && event.storageArea !== null
    for (const area of areas) {
      const entry = this.#entries.get(entryKeyFor(area, event.key))
      if (entry === undefined) continue
      // Trust the payload only when the event named a store we own; otherwise
      // read the store, so an event of unknown provenance cannot invent a value.
      if (knownArea) this.#applyRaw(entry, event.newValue)
      else this.#refresh(entry, true)
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

  #areasForEvent(event: StorageEventLike): readonly StorageArea[] {
    if (event.storageArea === undefined || event.storageArea === null) return AREAS
    for (const area of AREAS) {
      if (this.#sameArea(area, event.storageArea)) return [area]
    }
    return []
  }

  #sameArea(area: StorageArea, candidate: unknown): boolean {
    try {
      return this.#resolveArea(area) === candidate
    } catch {
      return false
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Entries                                                                 */
  /* ---------------------------------------------------------------------- */

  #resolveDeclaration<T>(
    definitionId: string,
    declaration: StorageKeyBinding<T>,
  ): ResolvedDeclaration {
    const area = declaration.area ?? DEFAULT_AREA
    const name = declaration.name
    if (typeof name !== 'string' || name.length === 0) {
      throw this.#error(definitionId, area, 'bind', null, {
        expected: 'a non-empty storage key name',
        observed: describeValue(name),
        declaredBy: 'The storage declaration this consumer supplied',
        repair: "Give the key a stable name, e.g. bind(id, { name: 'filters', schema }).",
      })
    }
    if (definitionId.length === 0 || definitionId.includes(':')) {
      throw this.#error(definitionId, area, 'bind', name, {
        expected: 'a definition id without a colon, so the `<id>:` prefix stays unambiguous',
        observed: describeValue(definitionId),
        declaredBy: 'The framework storage boundary',
        repair:
          'Use the globally unique definition id from the registry. The colon separates the id from the key name and cannot appear inside the id.',
      })
    }

    const version = declaration.version ?? DEFAULT_SCHEMA_VERSION
    if (!Number.isInteger(version) || version < 1) {
      throw this.#error(definitionId, area, 'bind', name, {
        expected: 'an integer schema version of 1 or more',
        observed: describeValue(declaration.version),
        declaredBy: 'The storage declaration this consumer supplied',
        repair:
          'Start at version 1 and increase it whenever the persisted representation changes, adding a migrate() for the previous version.',
      })
    }

    let declaresDefault = false
    let defaultValue: unknown = null
    if (declaration.defaultValue !== undefined) {
      const result = declaration.schema.safeParse(declaration.defaultValue)
      if (!result.success) {
        const issue = result.error.issues[0]
        throw this.#error(definitionId, area, 'bind', name, {
          expected: `a default matching the declared schema (${issue?.expected ?? issue?.message ?? 'schema mismatch'})`,
          observed: describeValue(declaration.defaultValue),
          declaredBy: 'The storage declaration this consumer supplied',
          repair:
            'Fix defaultValue so it satisfies the same schema as the stored value. The default is validated where it is declared, not on first use.',
          cause: result.error,
        })
      }
      declaresDefault = true
      defaultValue = result.data
    }

    return {
      name,
      area,
      schema: declaration.schema as ContractSchema<unknown>,
      retention: declaration.retention ?? DEFAULT_RETENTION,
      version,
      declaresDefault,
      defaultValue,
      defaultSignature: declaresDefault ? stableStringify(defaultValue) : NO_DEFAULT,
      ...(declaration.migrate === undefined
        ? {}
        : { migrate: declaration.migrate as (value: unknown, fromVersion: number) => unknown }),
    }
  }

  #acquireEntry(definitionId: string, declaration: ResolvedDeclaration): KeyEntry {
    const physicalKey = physicalStorageKey(definitionId, declaration.name)
    const entryKey = entryKeyFor(declaration.area, physicalKey)
    const existing = this.#entries.get(entryKey)
    if (existing !== undefined) {
      this.#assertCompatible(existing, declaration, true)
      return existing
    }
    const entry = this.#createEntry(definitionId, declaration, entryKey, physicalKey)
    this.#entries.set(entryKey, entry)
    // The one read per key binding. Everything after this is served from the
    // cached snapshot until the serialized representation actually changes.
    this.#refresh(entry, true)
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
      loaded: false,
      rawKnown: false,
      raw: null,
      snapshot: defaultSnapshot,
      getSnapshot: () => entry.snapshot,
      subscribe: (listener: Listener) => this.#listeners.subscribe(entryKey, listener),
      read: () => this.#readValue(entry, false, declaration.declaresDefault),
      set: (next: unknown, options?: StorageWriteOptions) => {
        this.#setValue(entry, next, options)
      },
      remove: (options?: StorageWriteOptions) => {
        this.#removeValue(entry, options)
      },
    }
    return entry
  }

  /**
   * Active declarations for one key must agree. A disagreement is reported to
   * the consumer that disagrees, rather than being resolved in favour of
   * whichever consumer happened to render first.
   */
  #assertCompatible(entry: KeyEntry, incoming: ResolvedDeclaration, compareDefault: boolean): void {
    const active = entry.declaration
    const mismatch = ((): { field: string; expected: string; observed: string } | null => {
      if (active.schema !== incoming.schema) {
        return {
          field: 'schema',
          expected: 'the same schema object every active consumer of this key already declared',
          observed: 'a different schema object',
        }
      }
      if (active.retention !== incoming.retention) {
        return {
          field: 'retention',
          expected: `retention '${active.retention}'`,
          observed: `retention '${incoming.retention}'`,
        }
      }
      if (active.version !== incoming.version) {
        return {
          field: 'version',
          expected: `version ${active.version}`,
          observed: `version ${incoming.version}`,
        }
      }
      if (compareDefault && active.defaultSignature !== incoming.defaultSignature) {
        return {
          field: 'defaultValue',
          expected: active.declaresDefault
            ? `the default ${stableStringify(active.defaultValue)}`
            : 'no declared default',
          observed: incoming.declaresDefault
            ? `the default ${stableStringify(incoming.defaultValue)}`
            : 'no declared default',
        }
      }
      return null
    })()

    if (mismatch === null) return

    throw this.#error(entry.definitionId, entry.area, 'bind', entry.name, {
      expected: mismatch.expected,
      observed: mismatch.observed,
      declaredBy: `Another active consumer of '${entry.physicalKey}', which declared it first`,
      repair: `Move the declaration of '${entry.physicalKey}' into one shared module so every consumer declares the same ${mismatch.field}. The framework does not settle the disagreement by whichever consumer rendered first.`,
    })
  }

  #releaseEntry(entry: KeyEntry): void {
    entry.bindings -= 1
    if (entry.bindings > 0) return
    if (this.#listeners.listenerCount(entry.entryKey) > 0) return
    this.#entries.delete(entry.entryKey)
  }

  /* ---------------------------------------------------------------------- */
  /* Reading                                                                 */
  /* ---------------------------------------------------------------------- */

  #refresh(entry: KeyEntry, force: boolean): boolean {
    if (entry.loaded && !force) return false
    let raw: string | null
    try {
      raw = this.#readRaw(entry.area, entry.physicalKey)
    } catch (error) {
      entry.loaded = true
      entry.rawKnown = false
      entry.raw = null
      return this.#publish(
        entry,
        this.#errorSnapshot(entry, 'read', {
          expected: `${entry.area} storage to be readable`,
          observed: describeThrown(error),
          declaredBy: 'The framework storage boundary',
          repair:
            'Browser storage is unavailable in this context - private mode, blocked cookies, or a disabled store. Handle the error: the framework never falls back to another store, to memory, or to the declared default.',
          cause: error,
        }),
      )
    }
    return this.#applyRaw(entry, raw)
  }

  #readRaw(area: StorageArea, key: string): string | null {
    const store = this.#resolveArea(area)
    this.#reads += 1
    return store.getItem(key)
  }

  /**
   * The only place a stored representation becomes a snapshot. An unchanged
   * serialized string is a no-op: nothing is parsed and nobody is notified.
   */
  #applyRaw(entry: KeyEntry, raw: string | null): boolean {
    if (entry.loaded && entry.rawKnown && entry.raw === raw) return false
    const outcome = this.#parseRaw(entry, raw)
    entry.raw = outcome.raw
    entry.rawKnown = true
    entry.loaded = true
    return this.#publish(entry, outcome.snapshot)
  }

  #publish(entry: KeyEntry, snapshot: StorageSnapshot<unknown>): boolean {
    if (snapshotsEquivalent(entry.snapshot, snapshot)) return false
    entry.snapshot = snapshot
    this.#listeners.notify(entry.entryKey)
    return true
  }

  #parseRaw(entry: KeyEntry, raw: string | null): ParseOutcome {
    const declaration = entry.declaration
    if (raw === null) return { snapshot: entry.defaultSnapshot, raw: null }

    this.#parses += 1

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      return {
        raw,
        snapshot: this.#errorSnapshot(entry, 'read', {
          expected: 'a JSON record written through the framework storage boundary',
          observed: `text that is not JSON (${describeThrown(error)})`,
          declaredBy: 'The framework storage boundary',
          repair: `Remove '${entry.physicalKey}' from ${entry.area} storage, or write it through the framework. A malformed record is reported, never replaced by the declared default.`,
          cause: error,
        }),
      }
    }

    if (!isStorageEnvelope(parsed)) {
      if (declaration.migrate === undefined) {
        return {
          raw,
          snapshot: this.#errorSnapshot(entry, 'read', {
            expected: `a framework envelope { v, r, d } at version ${declaration.version}`,
            observed: `an unversioned record (${describeValue(parsed)})`,
            declaredBy: 'The storage declaration this consumer supplied',
            repair: `Declare migrate(value, fromVersion) on '${entry.name}' to convert the pre-framework record, or remove the key. An unversioned record is never overwritten and never falls back to the default.`,
          }),
        }
      }
      return this.#migrateInto(entry, parsed, 0, raw)
    }

    const envelope: StorageEnvelope = parsed

    if (envelope.r === 'session') {
      if (this.#generation === null) {
        return {
          raw,
          snapshot: this.#errorSnapshot(entry, 'read', {
            expected:
              'the session generation to be established before a session-retained value is read',
            observed: 'a session-retained record with no session in force',
            declaredBy: 'The shell, which owns session identity',
            repair:
              'Give the storage store its session generation - through the constructor, establishSession, or applySessionTransition - before mounting anything that reads session-retained state.',
          }),
        }
      }
      // A record from another generation is absent, whether a retired session
      // left it behind or another tab wrote it late.
      if (envelope.g !== this.#generation) return { snapshot: entry.defaultSnapshot, raw }
    }

    if (envelope.v === declaration.version) {
      const result = declaration.schema.safeParse(envelope.d)
      if (result.success) return { raw, snapshot: { status: 'value', value: result.data } }
      const issue = result.error.issues[0]
      return {
        raw,
        snapshot: this.#errorSnapshot(entry, 'read', {
          expected: `a stored value matching the declared schema (${issue?.expected ?? issue?.message ?? 'schema mismatch'})`,
          observed: describeValue(envelope.d),
          declaredBy: 'The storage declaration this consumer supplied',
          repair: `The stored record no longer matches the schema. Raise the version of '${entry.name}' and declare migrate(value, fromVersion), or remove the key. The declared default does not stand in for a schema mismatch.`,
          cause: result.error,
        }),
      }
    }

    if (envelope.v > declaration.version) {
      return {
        raw,
        snapshot: this.#errorSnapshot(entry, 'read', {
          expected: `version ${declaration.version}`,
          observed: `version ${envelope.v}, written by a newer build`,
          declaredBy: 'The storage declaration this consumer supplied',
          repair: `Another tab or an older deployment is reading a record written by a newer version of '${entry.name}'. Reload into the current build; the framework never overwrites a future record and never replaces it with the default.`,
        }),
      }
    }

    if (declaration.migrate === undefined) {
      return {
        raw,
        snapshot: this.#errorSnapshot(entry, 'read', {
          expected: `version ${declaration.version}`,
          observed: `version ${envelope.v} with no migrate() declared`,
          declaredBy: 'The storage declaration this consumer supplied',
          repair: `Declare migrate(value, fromVersion) on '${entry.name}' to convert version ${envelope.v}, or remove the key. An unsupported old record fails visibly instead of being overwritten.`,
        }),
      }
    }

    return this.#migrateInto(entry, envelope.d, envelope.v, raw)
  }

  /**
   * Migration order: the old input is taken as `unknown`, converted by the
   * declared migrate(), the result is validated, and only then - and only while
   * the generation the conversion started in is still in force - is the
   * envelope replaced. The conversion runs once per active key, not once per
   * subscriber, because it runs inside the single parse of a changed record.
   */
  #migrateInto(entry: KeyEntry, input: unknown, fromVersion: number, raw: string): ParseOutcome {
    const declaration = entry.declaration
    const migrate = declaration.migrate
    if (migrate === undefined) return { snapshot: entry.defaultSnapshot, raw }

    const generationAtStart = this.#generation

    let converted: unknown
    try {
      converted = migrate(input, fromVersion)
    } catch (error) {
      return {
        raw,
        snapshot: this.#errorSnapshot(entry, 'migrate', {
          expected: `a value at version ${declaration.version}`,
          observed: `migrate() threw (${describeThrown(error)})`,
          declaredBy: 'The storage declaration this consumer supplied',
          repair: `Fix migrate() for '${entry.name}' from version ${fromVersion}. The previous record is preserved exactly as it was.`,
          cause: error,
        }),
      }
    }

    const result = declaration.schema.safeParse(converted)
    if (!result.success) {
      const issue = result.error.issues[0]
      return {
        raw,
        snapshot: this.#errorSnapshot(entry, 'migrate', {
          expected: `a migrated value matching the declared schema (${issue?.expected ?? issue?.message ?? 'schema mismatch'})`,
          observed: describeValue(converted),
          declaredBy: 'The storage declaration this consumer supplied',
          repair: `Fix migrate() for '${entry.name}' so its result satisfies the schema. The previous record is preserved; nothing was overwritten.`,
          cause: result.error,
        }),
      }
    }

    if (declaration.retention === 'session' && this.#generation !== generationAtStart) {
      return {
        raw,
        snapshot: this.#errorSnapshot(entry, 'migrate', {
          expected: `the migration to commit in the session generation it started in ('${String(generationAtStart)}')`,
          observed: `the session moved on to '${String(this.#generation)}'`,
          declaredBy: 'The framework storage boundary',
          repair:
            "A retired session's data is never migrated into a new one. Nothing was written, and the new session starts from the declared default.",
        }),
      }
    }

    let serialized: string
    try {
      serialized = this.#serialize(entry, result.data)
      this.#writeRaw(entry, serialized, 'migrate')
    } catch (error) {
      return {
        raw,
        snapshot: {
          status: 'error',
          error: error instanceof Error ? error : new Error(describeThrown(error)),
        },
      }
    }

    return { raw: serialized, snapshot: { status: 'value', value: result.data } }
  }

  /**
   * `declaresDefault` comes from the caller's own declaration, not from the
   * entry: a consumer that declared no default reads `null` for a missing key
   * whether or not another consumer of the same key is currently mounted.
   */
  #readValue(entry: KeyEntry, forceRead: boolean, declaresDefault: boolean): unknown {
    if (forceRead) this.#refresh(entry, true)
    const snapshot = entry.snapshot
    if (snapshot.status === 'error') throw snapshot.error
    if (snapshot.status === 'default') return declaresDefault ? snapshot.value : null
    return snapshot.value
  }

  /* ---------------------------------------------------------------------- */
  /* Writing                                                                 */
  /* ---------------------------------------------------------------------- */

  #setValue(entry: KeyEntry, next: unknown, options: StorageWriteOptions | undefined): void {
    this.#assertUsable('write a storage key')
    this.#assertWritable(entry, 'write', options)

    let candidate = next
    if (typeof next === 'function') {
      // A functional update resolves against the latest valid stored value, not
      // against whatever this document last rendered.
      this.#refresh(entry, true)
      const snapshot = entry.snapshot
      if (snapshot.status === 'error') {
        throw this.#error(entry.definitionId, entry.area, 'write', entry.name, {
          expected: 'a readable current value for the functional update to apply to',
          observed: `an unreadable record (${snapshot.error.message})`,
          declaredBy: 'The framework storage boundary',
          repair: `Write an explicit value to '${entry.name}', or remove the key first. A functional update has no valid base while the stored record is unreadable.`,
          cause: snapshot.error,
        })
      }
      const current =
        snapshot.status === 'default' && !entry.declaration.declaresDefault ? null : snapshot.value
      candidate = (next as (value: unknown) => unknown)(current)
    }

    const validated = this.#validateForWrite(entry, candidate)
    const serialized = this.#serialize(entry, validated)
    this.#writeRaw(entry, serialized, 'write')

    entry.raw = serialized
    entry.rawKnown = true
    entry.loaded = true
    this.#publish(entry, { status: 'value', value: validated })
  }

  #removeValue(entry: KeyEntry, options: StorageWriteOptions | undefined): void {
    this.#assertUsable('remove a storage key')
    this.#assertGenerationFence(entry, 'remove', options)

    const store = this.#resolveAreaOrFail(entry.definitionId, entry.area, 'remove', entry.name)
    try {
      store.removeItem(entry.physicalKey)
    } catch (error) {
      throw this.#error(entry.definitionId, entry.area, 'remove', entry.name, {
        expected: `to remove '${entry.physicalKey}'`,
        observed: describeThrown(error),
        declaredBy: 'The framework storage boundary',
        repair: 'Retry the removal; the stored value is unchanged.',
        cause: error,
      })
    }

    entry.raw = null
    entry.rawKnown = true
    entry.loaded = true
    this.#publish(entry, entry.defaultSnapshot)
  }

  #validateForWrite(entry: KeyEntry, value: unknown): unknown {
    const result = entry.declaration.schema.safeParse(value)
    if (result.success) return result.data
    const issue = result.error.issues[0]
    throw this.#error(entry.definitionId, entry.area, 'write', entry.name, {
      expected: `a value matching the declared schema (${issue?.expected ?? issue?.message ?? 'schema mismatch'})`,
      observed: describeValue(value),
      declaredBy: 'The storage declaration this consumer supplied',
      repair: `Fix the value passed to set() for '${entry.name}'. The stored value is unchanged.`,
      cause: result.error,
    })
  }

  #serialize(entry: KeyEntry, value: unknown): string {
    const declaration = entry.declaration
    const envelope: StorageEnvelope = {
      v: declaration.version,
      r: declaration.retention,
      // Only the opaque generation is persisted: never a token, never a group list.
      ...(declaration.retention === 'session' && this.#generation !== null
        ? { g: this.#generation }
        : {}),
      d: value,
    }
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(envelope)
    } catch (error) {
      throw this.#error(entry.definitionId, entry.area, 'write', entry.name, {
        expected: 'a JSON-serializable value',
        observed: describeThrown(error),
        declaredBy: 'The framework storage boundary',
        repair:
          'Store plain JSON data. Functions, class instances, cycles and bigints cannot be persisted. The stored value is unchanged.',
        cause: error,
      })
    }
    if (serialized === undefined) {
      throw this.#error(entry.definitionId, entry.area, 'write', entry.name, {
        expected: 'a JSON-serializable value',
        observed: 'a value JSON.stringify discarded',
        declaredBy: 'The framework storage boundary',
        repair: 'Store plain JSON data. The stored value is unchanged.',
      })
    }
    return serialized
  }

  #writeRaw(entry: KeyEntry, serialized: string, verb: string): void {
    const store = this.#resolveAreaOrFail(entry.definitionId, entry.area, verb, entry.name)
    try {
      store.setItem(entry.physicalKey, serialized)
      this.#writes += 1
    } catch (error) {
      throw this.#error(entry.definitionId, entry.area, verb, entry.name, {
        expected: `${entry.area} storage to accept ${serialized.length} characters`,
        observed: describeThrown(error),
        declaredBy: 'The framework storage boundary',
        repair:
          'The store is full or blocked. Persist less, or clear this definition. The stored value is unchanged and no other key was touched.',
        cause: error,
      })
    }
  }

  #assertWritable(entry: KeyEntry, verb: string, options: StorageWriteOptions | undefined): void {
    this.#assertGenerationFence(entry, verb, options)
    if (entry.declaration.retention === 'session' && this.#generation === null) {
      throw this.#error(entry.definitionId, entry.area, verb, entry.name, {
        expected:
          'the session generation to be established before a session-retained value is written',
        observed: 'no session in force',
        declaredBy: 'The shell, which owns session identity',
        repair:
          "Give the storage store its session generation before mounting, or declare retention: 'preference' if the value must outlive the session.",
      })
    }
  }

  /** Rejects a write a caller committed from a session that has since retired. */
  #assertGenerationFence(
    entry: KeyEntry,
    verb: string,
    options: StorageWriteOptions | undefined,
  ): void {
    const expected = options?.generation
    if (expected === undefined || expected === this.#generation) return
    throw this.#error(entry.definitionId, entry.area, verb, entry.name, {
      expected: `the write to commit in the session generation it started in ('${expected}')`,
      observed:
        this.#generation === null
          ? 'no session in force'
          : `the session moved on to '${this.#generation}'`,
      declaredBy: 'The framework storage boundary',
      repair:
        'Drop the result: work started in a retired session never commits into the new one. Re-read the value in the current session and start again.',
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Imperative surface                                                      */
  /* ---------------------------------------------------------------------- */

  #imperativeKey<T>(
    definitionId: string,
    area: StorageArea,
    name: string,
    schema: ContractSchema<T>,
    options: StorageKeyOptions<T> | undefined,
  ): MfeStorageKey<T> {
    const declaration: StorageKeyBinding<T> = {
      name,
      area,
      schema,
      ...(options?.retention === undefined ? {} : { retention: options.retention }),
      ...(options?.version === undefined ? {} : { version: options.version }),
      ...(options?.migrate === undefined ? {} : { migrate: options.migrate }),
    }
    const resolved = this.#resolveDeclaration(definitionId, declaration)

    return {
      get: (): T | null => {
        const entry = this.#workingEntry(definitionId, resolved)
        return this.#readValue(entry, true, resolved.declaresDefault) as T | null
      },
      set: (value: T): void => {
        const entry = this.#workingEntry(definitionId, resolved)
        this.#setValue(entry, value, undefined)
      },
      remove: (): void => {
        const entry = this.#workingEntry(definitionId, resolved)
        this.#removeValue(entry, undefined)
      },
    }
  }

  #imperativeRemove(definitionId: string, area: StorageArea, name: string): void {
    this.#assertUsable('remove a storage key')
    const physical = physicalStorageKey(definitionId, name)
    const bound = this.#entries.get(entryKeyFor(area, physical))
    if (bound !== undefined) {
      this.#removeValue(bound, undefined)
      return
    }

    const store = this.#resolveAreaOrFail(definitionId, area, 'remove', name)
    try {
      store.removeItem(physical)
    } catch (error) {
      throw this.#error(definitionId, area, 'remove', name, {
        expected: `to remove '${physical}'`,
        observed: describeThrown(error),
        declaredBy: 'The framework storage boundary',
        repair: 'Retry the removal; the stored value is unchanged.',
        cause: error,
      })
    }
  }

  /**
   * An imperative operation reuses the active entry when the key is bound, so
   * the write notifies its subscribers; otherwise it works through a detached
   * entry that caches nothing. An imperative declaration carries no default, so
   * it is not compared against the bound one.
   */
  #workingEntry(definitionId: string, declaration: ResolvedDeclaration): KeyEntry {
    const physicalKey = physicalStorageKey(definitionId, declaration.name)
    const entryKey = entryKeyFor(declaration.area, physicalKey)
    const existing = this.#entries.get(entryKey)
    if (existing !== undefined) {
      this.#assertCompatible(existing, declaration, false)
      return existing
    }
    return this.#createEntry(definitionId, declaration, entryKey, physicalKey)
  }

  /* ---------------------------------------------------------------------- */
  /* Areas, errors, diagnostics                                              */
  /* ---------------------------------------------------------------------- */

  #resolveArea(area: StorageArea): StorageAreaLike {
    const source = area === 'local' ? this.#areas.local : this.#areas.session
    if (typeof source === 'function') return source()
    if (source !== undefined) return source
    const holder = globalThis as {
      localStorage?: StorageAreaLike
      sessionStorage?: StorageAreaLike
    }
    // Property access itself can throw in a locked-down browsing context.
    const resolved = area === 'local' ? holder.localStorage : holder.sessionStorage
    if (resolved === undefined || resolved === null) {
      throw new Error(`${area}Storage is not available in this context`)
    }
    return resolved
  }

  #resolveAreaOrFail(
    definitionId: string,
    area: StorageArea,
    verb: string,
    name: string | null,
  ): StorageAreaLike {
    try {
      return this.#resolveArea(area)
    } catch (error) {
      throw this.#error(definitionId, area, verb, name, {
        expected: `${area} storage to be available`,
        observed: describeThrown(error),
        declaredBy: 'The framework storage boundary',
        repair:
          'Browser storage is unavailable in this context - private mode, blocked cookies, or a disabled store. Handle the error: the framework never falls back to another store or to memory.',
        cause: error,
      })
    }
  }

  #listKeys(store: StorageAreaLike): readonly string[] {
    const names: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const name = store.key(index)
      if (name !== null) names.push(name)
    }
    return names
  }

  #errorSnapshot(
    entry: KeyEntry,
    verb: string,
    details: Omit<MfeErrorDetails, 'code' | 'id' | 'operation' | 'path'>,
  ): StorageSnapshot<unknown> {
    return {
      status: 'error',
      error: this.#error(entry.definitionId, entry.area, verb, entry.name, details),
    }
  }

  #error(
    definitionId: string,
    area: StorageArea,
    verb: string,
    name: string | null,
    details: Omit<MfeErrorDetails, 'code' | 'id' | 'operation' | 'path'>,
  ): MfeError {
    const error = createMfeError({
      ...details,
      code: 'storage/failure',
      id: definitionId,
      operation: name === null ? `clear ${area} storage` : `${verb} the ${area} storage key`,
      ...(name === null ? {} : { path: [name] }),
    })
    this.#diagnostics?.report(error, {
      severity: 'error',
      context: { definitionId, area, ...(name === null ? {} : { key: name }) },
    })
    return error
  }

  #failSession(
    operation: string,
    details: Omit<MfeErrorDetails, 'code' | 'id' | 'operation'>,
  ): MfeError {
    const error = createMfeError({ ...details, code: 'storage/failure', id: 'shell', operation })
    this.#diagnostics?.report(error, { severity: 'error', context: { operation } })
    return error
  }

  #reportAreaFailure(area: StorageArea, operation: string, cause: unknown): void {
    this.#diagnostics?.report(
      toMfeError(cause, {
        code: 'storage/failure',
        id: 'shell',
        operation: `${operation} in ${area} storage`,
        expected: `${area} storage to be readable and writable`,
        declaredBy: 'The framework storage boundary',
        repair:
          'A record that could not be removed stays fenced off by the session generation, so it cannot be read into the new session.',
      }),
      { severity: 'warning', context: { area, operation } },
    )
  }

  #reportListenerError(error: unknown): void {
    this.#diagnostics?.report(
      toMfeError(error, {
        code: 'storage/failure',
        id: 'shell',
        operation: 'notify a storage subscriber',
        expected: 'a subscriber callback that does not throw',
        declaredBy: 'The framework storage boundary',
        repair: 'Fix the subscriber; the remaining subscribers were notified regardless.',
      }),
      { severity: 'warning' },
    )
  }

  #assertUsable(operation: string): void {
    if (!this.#disposed) return
    throw this.#failSession(operation, {
      expected: 'a live storage store',
      observed: 'a store that was already disposed',
      declaredBy: 'The framework storage boundary',
      repair: 'Create a new MfeStorageStore; a disposed one no longer observes storage events.',
    })
  }
}
