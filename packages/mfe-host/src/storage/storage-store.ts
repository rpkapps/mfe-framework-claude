/**
 * The framework's single owner of browser storage.
 *
 * A failure is always structured, never a silent fallback to the declared
 * default. A key is parsed once per changed record, not once per subscriber. The
 * opaque session generation fences retired data, so a late cross-tab write or a
 * failed delete cannot resurrect it.
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
  type DiagnosticsHub,
  type Listener,
  type MfeError,
  type MfeStorage,
  type MfeStorageKey,
  type StorageArea,
  type StorageKeyOptions,
  type StorageRetention,
  type StorageSnapshot,
  type Unsubscribe,
} from '@company/mfe-core'

import type { z } from 'zod'

import {
  DECLARATION,
  describeIssue,
  describeThrown,
  readEnvelope,
  serializeEnvelope,
  SHELL,
  type Detail,
  type EnvelopeContext,
} from './envelope.ts'

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
  StorageWriteOptions,
} from './types.ts'

const AREAS = ['local', 'session'] as const
const DEFAULT_AREA: StorageArea = 'local'

/** `<id>:<name>` with a colon-free id, so prefix ownership is unambiguous. */
const FRAMEWORK_KEY = /^[^:]+:.+$/

const NO_VALUE = '<no-value>'
const NO_DEFAULT = '<no-default>'

const BOUNDARY = 'The framework storage boundary'

/** Key-order-independent, so a re-serialization compares equal to its original. */
function stableStringify(value: unknown): string {
  if (value === undefined) return NO_VALUE
  try {
    return (
      JSON.stringify(value, (_key, entry: unknown) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry
        const record = entry as Record<string, unknown>
        return Object.fromEntries(
          Object.keys(record)
            .sort()
            .map(key => [key, record[key]]),
        )
      }) ?? NO_VALUE
    )
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
    ? globalThis
    : null
}

interface ResolvedDeclaration {
  readonly name: string
  readonly area: StorageArea
  readonly schema: z.ZodType
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

export class MfeStorageStore {
  readonly #areas: { readonly local?: StorageAreaSource; readonly session?: StorageAreaSource }
  readonly #diagnostics: DiagnosticsHub | undefined
  readonly #listeners: KeyedListeners
  readonly #entries = new Map<string, KeyEntry>()
  /** Every generation this store has been given; a generation is never reused. */
  readonly #seenGenerations = new Set<string>()
  readonly #eventTarget: StorageEventTargetLike | null
  readonly #nativeListener: (event: Event) => void

  #generation: string | null
  #groups: string | null
  #disposed = false

  constructor(options: MfeStorageStoreOptions = {}) {
    this.#areas = options.areas ?? {}
    this.#diagnostics = options.diagnostics
    this.#generation = options.sessionGeneration ?? null
    if (this.#generation !== null) this.#seenGenerations.add(this.#generation)
    this.#groups = options.groups === undefined ? null : canonicalGroups(options.groups)
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

  get sessionGeneration(): string | null {
    return this.#generation
  }

  /**
   * Establishes the first generation of a continuous session. Rotating an
   * existing one goes through `applySessionTransition`, which invalidates the
   * records the retired session left behind first.
   */
  establishSession(generation: string): void {
    this.#assertUsable('establish the session generation')
    if (this.#generation === generation) return
    if (this.#generation !== null) {
      throw this.#failStore('establish the session generation', {
        expected: `no generation, or the one in force ('${this.#generation}')`,
        observed: `a different generation ('${generation}')`,
        repair: 'Rotate through applySessionTransition so the retired records are invalidated.',
      })
    }
    this.#assertFreshGeneration(generation, 'establish the session generation')
    this.#seenGenerations.add(generation)
    this.#generation = generation
    // A session record means something different now, though its text is unchanged.
    for (const entry of this.#entries.values()) {
      if (entry.declaration.retention !== 'session') continue
      this.#invalidateCache(entry)
      this.#refresh(entry)
    }
  }

  /**
   * Theme and token refresh invalidate nothing, and a reordered but identical
   * group set is a no-op. An identity or semantic group change retires the
   * in-memory snapshots, drops the persisted session records of every definition
   * whether mounted or not, then publishes the defaults. Preferences survive.
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
      throw this.#failStore('apply a session transition', {
        expected: 'a fresh opaque session generation for the new session',
        observed: nextGeneration === '' ? 'an empty string' : 'nothing',
        declaredBy: SHELL,
        repair: 'Pass a new opaque generation — never a token, never a group list.',
      })
    }
    this.#assertFreshGeneration(nextGeneration, 'apply a session transition')

    const stale = new Map<KeyEntry, StorageSnapshot<unknown>>()
    for (const entry of this.#entries.values()) {
      if (entry.declaration.retention !== 'session') continue
      stale.set(entry, entry.snapshot)
      entry.snapshot = entry.defaultSnapshot
      this.#invalidateCache(entry)
    }

    this.#seenGenerations.add(nextGeneration)
    this.#generation = nextGeneration
    this.#rememberGroups(transition)
    const removedRecords = this.#purgeSessionRecords()

    let notifiedKeys = 0
    for (const [entry, previous] of stale) {
      this.#refresh(entry)
      if (snapshotsEquivalent(previous, entry.snapshot)) continue
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
        return this.#groups !== null && canonicalGroups(transition.groups) === this.#groups
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
    throw this.#failStore(operation, {
      expected: 'a generation this store has never seen before',
      observed: `the already-used generation '${generation}'`,
      repair:
        'Mint a new generation per session; reusing one would make its invalidated records readable again.',
    })
  }

  /**
   * Removes every record marked `r: 'session'` from both stores. Anything that is
   * not a framework envelope is left alone: this store never removes what it did
   * not write.
   */
  #purgeSessionRecords(): number {
    let removed = 0
    for (const area of AREAS) {
      let store: StorageAreaLike
      let names: readonly string[]
      try {
        store = this.#resolveArea(area)
        names = this.#listKeys(store)
      } catch (error) {
        this.#reportAreaFailure(area, error)
        continue
      }

      for (const name of names) {
        if (!FRAMEWORK_KEY.test(name)) continue
        try {
          const raw = store.getItem(name)
          if (raw === null) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            continue // Not a framework record, so the framework does not own it.
          }
          if (!isStorageEnvelope(parsed) || parsed.r !== 'session') continue
          store.removeItem(name)
          removed += 1
        } catch (error) {
          // A record that survives stays fenced off by the generation check.
          this.#reportAreaFailure(area, error)
        }
      }
    }
    return removed
  }

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

  /** The imperative surface. A write through it notifies the key's subscribers. */
  storageFor(definitionId: string, area: StorageArea = DEFAULT_AREA): MfeStorage {
    return {
      key: <T>(
        name: string,
        schema: z.ZodType<T>,
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
   * Removes every key under the exact `<id>:` prefix. `acme-orders` never touches
   * `acme-orders-legacy:`, the shell's keys, or a third party's.
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
          throw this.#fail(definitionId, target, 'clear', null, {
            expected: `to enumerate ${target} storage for keys under '${prefix}'`,
            observed: describeThrown(error),
            repair: 'The framework never clears a store it cannot enumerate. Handle the failure.',
            cause: error,
          })
        }
        for (const name of names) {
          try {
            store.removeItem(name)
            removed += 1
          } catch (error) {
            throw this.#fail(definitionId, target, 'clear', null, {
              expected: `to remove '${name}'`,
              observed: describeThrown(error),
              repair: `Retry; keys already removed stay removed and nothing outside '${prefix}' was touched.`,
              cause: error,
            })
          }
        }
      } finally {
        for (const entry of this.#entries.values()) {
          if (entry.area === target && entry.definitionId === definitionId) this.#refresh(entry)
        }
      }
    }
    return removed
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#eventTarget?.removeEventListener('storage', this.#nativeListener)
    this.#listeners.clear()
    this.#entries.clear()
  }

  /**
   * Applies a native `storage` event from another tab. An event for a key nobody
   * is bound to is ignored, and a store-wide clear checks only the active keys.
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
      // Trust the payload only when the event named a store we own; otherwise read
      // it, so an event of unknown provenance cannot invent a value.
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

  #areasForEvent(event: StorageEventLike): readonly StorageArea[] {
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
    const area = declaration.area ?? DEFAULT_AREA
    const name = declaration.name

    if (typeof name !== 'string' || name.length === 0) {
      throw this.#fail(definitionId, area, 'bind', null, {
        expected: 'a non-empty storage key name',
        observed: describeValue(name),
        declaredBy: DECLARATION,
        repair: "Give the key a stable name, e.g. bind(id, { name: 'filters', schema }).",
      })
    }
    if (definitionId.length === 0 || definitionId.includes(':')) {
      throw this.#fail(definitionId, area, 'bind', name, {
        expected: 'a definition id without a colon',
        observed: describeValue(definitionId),
        repair: 'Use the registry definition id; the colon separates the id from the key name.',
      })
    }

    const version = declaration.version ?? DEFAULT_SCHEMA_VERSION
    if (!Number.isInteger(version) || version < 1) {
      throw this.#fail(definitionId, area, 'bind', name, {
        expected: 'an integer schema version of 1 or more',
        observed: describeValue(declaration.version),
        declaredBy: DECLARATION,
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
          declaredBy: DECLARATION,
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
      schema: declaration.schema,
      retention: declaration.retention ?? DEFAULT_RETENTION,
      version,
      declaresDefault,
      defaultValue,
      defaultSignature: declaresDefault ? stableStringify(defaultValue) : NO_DEFAULT,
      ...(declaration.migrate === undefined ? {} : { migrate: declaration.migrate }),
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
   * Active declarations for one key must agree. The disagreement is reported to
   * the consumer that disagrees, not resolved in favour of whoever rendered first.
   */
  #assertCompatible(entry: KeyEntry, incoming: ResolvedDeclaration, compareDefault: boolean): void {
    const active = entry.declaration
    const shownDefault = (declaration: ResolvedDeclaration): string =>
      declaration.declaresDefault
        ? `the default ${stableStringify(declaration.defaultValue)}`
        : 'no declared default'

    const checks: readonly (readonly [boolean, string, string, string])[] = [
      [
        active.schema !== incoming.schema,
        'schema',
        'the same schema object every active consumer already declared',
        'a different schema object',
      ],
      [
        active.retention !== incoming.retention,
        'retention',
        `retention '${active.retention}'`,
        `retention '${incoming.retention}'`,
      ],
      [
        active.version !== incoming.version,
        'version',
        `version ${active.version}`,
        `version ${incoming.version}`,
      ],
      [
        compareDefault && active.defaultSignature !== incoming.defaultSignature,
        'defaultValue',
        shownDefault(active),
        shownDefault(incoming),
      ],
    ]

    const mismatch = checks.find(([differs]) => differs)
    if (mismatch === undefined) return
    const [, field, expected, observed] = mismatch

    throw this.#fail(entry.definitionId, entry.area, 'bind', entry.name, {
      expected,
      observed,
      declaredBy: `Another active consumer of '${entry.physicalKey}', which declared it first`,
      repair: `Declare '${entry.physicalKey}' in one shared module so every consumer agrees on ${field}.`,
    })
  }

  #releaseEntry(entry: KeyEntry): void {
    entry.bindings -= 1
    if (entry.bindings > 0) return
    if (this.#listeners.listenerCount(entry.entryKey) > 0) return
    this.#entries.delete(entry.entryKey)
  }

  #invalidateCache(entry: KeyEntry): void {
    entry.loaded = false
    entry.rawKnown = false
    entry.raw = null
  }

  #refresh(entry: KeyEntry): boolean {
    let raw: string | null
    try {
      raw = this.#resolveArea(entry.area).getItem(entry.physicalKey)
    } catch (error) {
      entry.loaded = true
      entry.rawKnown = false
      entry.raw = null
      return this.#publish(
        entry,
        this.#errorSnapshot(entry, 'read', {
          expected: `${entry.area} storage to be readable`,
          observed: describeThrown(error),
          repair:
            'Storage is unavailable here — private mode, blocked cookies, or a disabled store. The framework never falls back to memory or to the declared default.',
          cause: error,
        }),
      )
    }
    return this.#applyRaw(entry, raw)
  }

  /** The only place a stored representation becomes a snapshot. */
  #applyRaw(entry: KeyEntry, raw: string | null): boolean {
    if (entry.loaded && entry.rawKnown && entry.raw === raw) return false
    const outcome = readEnvelope(this.#envelopeContext(entry), raw)
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

  /**
   * `declaresDefault` comes from the caller's own declaration: a consumer that
   * declared no default reads `null` for a missing key whether or not another
   * consumer of the same key is mounted.
   */
  #readValue(entry: KeyEntry, forceRead: boolean, declaresDefault: boolean): unknown {
    if (forceRead) this.#refresh(entry)
    const snapshot = entry.snapshot
    if (snapshot.status === 'error') throw snapshot.error
    if (snapshot.status === 'default') return declaresDefault ? snapshot.value : null
    return snapshot.value
  }

  #setValue(entry: KeyEntry, next: unknown, options: StorageWriteOptions | undefined): void {
    this.#assertUsable('write a storage key')
    this.#assertGenerationFence(entry, 'write', options)
    if (entry.declaration.retention === 'session' && this.#generation === null) {
      throw this.#fail(entry.definitionId, entry.area, 'write', entry.name, {
        expected: 'the session generation to be established before a session value is written',
        observed: 'no session in force',
        declaredBy: SHELL,
        repair: "Establish the generation before mounting, or declare retention: 'preference'.",
      })
    }

    let candidate = next
    if (typeof next === 'function') {
      // A functional update resolves against the latest stored value, not against
      // whatever this document last rendered.
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
        declaredBy: DECLARATION,
        repair: `Fix the value passed to set() for '${entry.name}'. The stored value is unchanged.`,
        cause: result.error,
      })
    }

    const serialized = serializeEnvelope(
      entry.declaration,
      this.#generation,
      result.data,
      (verb, detail) => this.#fail(entry.definitionId, entry.area, verb, entry.name, detail),
    )
    this.#writeRaw(entry, serialized, 'write')
    entry.raw = serialized
    entry.rawKnown = true
    entry.loaded = true
    this.#publish(entry, { status: 'value', value: result.data })
  }

  #removeValue(entry: KeyEntry, options: StorageWriteOptions | undefined): void {
    this.#assertUsable('remove a storage key')
    this.#assertGenerationFence(entry, 'remove', options)
    this.#removeRaw(entry.definitionId, entry.area, entry.name, entry.physicalKey)
    entry.raw = null
    entry.rawKnown = true
    entry.loaded = true
    this.#publish(entry, entry.defaultSnapshot)
  }

  #removeRaw(definitionId: string, area: StorageArea, name: string, physicalKey: string): void {
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
          'The store is full or blocked. Persist less, or clear this definition. The stored value is unchanged and no other key was touched.',
        cause: error,
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
    throw this.#fail(entry.definitionId, entry.area, verb, entry.name, {
      expected: `the write to commit in the generation it started in ('${expected}')`,
      observed:
        this.#generation === null
          ? 'no session in force'
          : `the session moved on to '${this.#generation}'`,
      repair: 'Drop the result: work started in a retired session never commits into the new one.',
    })
  }

  #imperativeKey<T>(
    definitionId: string,
    area: StorageArea,
    name: string,
    schema: z.ZodType<T>,
    options: StorageKeyOptions<T> | undefined,
  ): MfeStorageKey<T> {
    const resolved = this.#resolveDeclaration(definitionId, {
      name,
      area,
      schema,
      ...(options?.retention === undefined ? {} : { retention: options.retention }),
      ...(options?.version === undefined ? {} : { version: options.version }),
      ...(options?.migrate === undefined ? {} : { migrate: options.migrate }),
    })

    return {
      get: (): T | null =>
        this.#readValue(
          this.#workingEntry(definitionId, resolved),
          true,
          resolved.declaresDefault,
        ) as T | null,
      set: (value: T): void => {
        this.#setValue(this.#workingEntry(definitionId, resolved), value, undefined)
      },
      remove: (): void => {
        this.#removeValue(this.#workingEntry(definitionId, resolved), undefined)
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
    this.#removeRaw(definitionId, area, name, physical)
  }

  /**
   * An imperative operation reuses the active entry when the key is bound, so the
   * write notifies its subscribers; otherwise it works through a detached entry
   * that caches nothing. An imperative declaration carries no default, so it is
   * not compared against the bound one.
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

  #resolveArea(area: StorageArea): StorageAreaLike {
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
    area: StorageArea,
    verb: string,
    name: string | null,
  ): StorageAreaLike {
    try {
      return this.#resolveArea(area)
    } catch (error) {
      throw this.#fail(definitionId, area, verb, name, {
        expected: `${area} storage to be available`,
        observed: describeThrown(error),
        repair:
          'Storage is unavailable here — private mode, blocked cookies, or a disabled store. The framework never falls back to another store or to memory.',
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

  #envelopeContext(entry: KeyEntry): EnvelopeContext {
    return {
      declaration: entry.declaration,
      physicalKey: entry.physicalKey,
      area: entry.area,
      defaultSnapshot: entry.defaultSnapshot,
      generation: () => this.#generation,
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
    area: StorageArea,
    verb: string,
    name: string | null,
    detail: Detail,
  ): MfeError {
    const error = createMfeError({
      declaredBy: BOUNDARY,
      ...detail,
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

  #failStore(operation: string, detail: Detail): MfeError {
    const error = createMfeError({
      declaredBy: BOUNDARY,
      ...detail,
      code: 'storage/failure',
      id: 'shell',
      operation,
    })
    this.#diagnostics?.report(error, { severity: 'error', context: { operation } })
    return error
  }

  #warn(operation: string, cause: unknown, detail: Detail): void {
    this.#diagnostics?.report(
      toMfeError(cause, {
        declaredBy: BOUNDARY,
        ...detail,
        code: 'storage/failure',
        id: 'shell',
        operation,
      }),
      { severity: 'warning', context: { operation } },
    )
  }

  #reportAreaFailure(area: StorageArea, cause: unknown): void {
    this.#warn(`invalidate session records in ${area} storage`, cause, {
      expected: `${area} storage to be readable and writable`,
      repair:
        'A record that could not be removed stays fenced off by the generation, so it cannot be read into the new session.',
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
}
