import { isValidDefinitionId } from '@company/mfe-core/definition'
import { isMfeError } from '@company/mfe-core/errors'
import {
  applyStateWrite,
  assertStateContract,
  assertJson,
  isObject,
  immutable,
  normalize,
  UserContextError,
  stableJson,
  stateCapabilities,
  userContextReadCapabilities,
  type Json,
  type UserContextAdapter,
  type UserContextManifest,
  type UserContextRequirements,
  type UserContextService,
  type UserContextInspection,
  type UserContextInspectionSnapshot,
  type UserContextStore,
  type UserContextReader,
  type StateContract,
  type StateRecord,
  type StateValues,
} from '@company/mfe-core/user-context'

export interface UserContextOptions {
  readonly scope: string
  /** Latest compiled schema; compatibility history stays in build/release tooling. */
  readonly schema: UserContextManifest | readonly UserContextManifest[]
  readonly adapter: UserContextAdapter
  readonly onError?: (error: unknown, id: string) => void
}
interface Pending {
  readonly expectedRevision: number
  readonly operationId: string
  readonly value: Json
  readonly resolve: (value: Json) => void
  readonly reject: (error: unknown) => void
}
interface Entry {
  readonly canonical: StateContract
  status: 'absent' | 'hydrating' | 'ready' | 'invalid' | 'persistence-failed'
  recordRevision: number
  confirmed: Json | undefined
  /** Raw accepted data distinguishes absent default branches from persisted unknown fields. */
  persisted: Json | undefined
  effective: Json | undefined
  error?: unknown
  readonly views: Map<
    string,
    { readonly json: string; readonly value: unknown; readonly source: Json | undefined }
  >
  readonly listeners: Set<() => void>
  readonly pending: Pending[]
  notifiedJson?: string
  notifiedInvalid?: boolean
  hydration?: Promise<void>
}

/** Shell-owned, independent of module identity. Bindings capture a scope generation. */
export class UserContextRuntime implements UserContextService {
  readonly protocolVersion = 1
  readonly #options: UserContextOptions
  readonly #contracts = new Map<string, StateContract>()
  readonly #entries = new Map<string, Entry>()
  readonly #sending = new Set<Entry>()
  readonly #inflight = new Set<Pending>()
  readonly #capabilities = new Map<
    string,
    { readonly owned: ReadonlySet<string>; readonly read: ReadonlySet<string> }
  >()
  #scope: string
  #generation = 0
  #controller = new AbortController()
  #unsubscribe: (() => void) | undefined
  #disposed = false
  #operation = 0
  readonly #clientId = crypto.randomUUID()
  readonly #inspectionListeners = new Set<() => void>()
  #inspectionSnapshot: UserContextInspectionSnapshot | undefined

  /** Snapshots are built on demand and share already immutable values, never consumer bindings. */
  readonly inspection: UserContextInspection = {
    getSnapshot: () => {
      this.#inspectionSnapshot ??= Object.freeze({
        generation: this.#generation,
        disposed: this.#disposed,
        entries: Object.freeze(
          [...this.#entries.values()].map(entry =>
            Object.freeze({
              contract: entry.canonical,
              status: entry.status,
              recordRevision: entry.recordRevision,
              pendingWrites: entry.pending.length,
              confirmed: entry.confirmed,
              effective: entry.effective,
              error: entry.error === undefined ? undefined : asError(entry.error).message,
            }),
          ),
        ),
      })
      return this.#inspectionSnapshot
    },
    subscribe: listener => {
      if (this.#disposed) return () => {}
      this.#inspectionListeners.add(listener)
      return () => {
        this.#inspectionListeners.delete(listener)
      }
    },
  }

  constructor(options: UserContextOptions) {
    this.#options = options
    this.#scope = options.scope
    const manifests: readonly UserContextManifest[] = Array.isArray(options.schema)
      ? options.schema
      : [options.schema as UserContextManifest]
    if (!options.scope || manifests.some(manifest => manifest.formatVersion !== 1))
      throw new UserContextError(
        'unsupported-contract',
        '<schema>',
        'Configure a nonempty opaque scope and contract format 1',
      )
    for (const contract of manifests.flatMap(manifest => manifest.contracts)) {
      assertStateContract(contract)
      if (this.#contracts.has(contract.id) || !objectNode(contract.node))
        throw new UserContextError(
          'unsupported-contract',
          contract.id,
          'Schema needs one current contract per owner ID',
        )
      this.#contracts.set(contract.id, immutable(structuredClone(contract)))
      const capabilities = stateCapabilities(contract.node)
      this.#capabilities.set(contract.id, {
        owned: new Set(capabilities),
        read: new Set(userContextReadCapabilities(capabilities)),
      })
    }
    this.#resetEntries()
    this.#listen()
    this.#notifyInspection()
  }

  async prepare(requirements: UserContextRequirements, signal?: AbortSignal): Promise<void> {
    const generation = this.#generation
    this.#check(requirements)
    const hydration = Promise.all(
      requirements.contracts.map(({ id }) => this.#hydrate(this.#entry(id), generation)),
    )
    await abortable(hydration, signal)
    this.#assertGeneration(generation)
  }

  bind<V = StateValues>(
    definitionId: string,
    requirements: UserContextRequirements,
    signal?: AbortSignal,
  ): UserContextStore<V> {
    return this.#bind<V>(
      definitionId,
      requirements,
      definitionId,
      signal,
      true,
    ) as UserContextStore<V>
  }

  bindReadOnly<V = StateValues>(
    definitionId: string,
    requirements: UserContextRequirements,
    ownerId: string,
    signal?: AbortSignal,
  ): UserContextReader<V> {
    return this.#bind<V>(definitionId, requirements, ownerId, signal, false)
  }

  #bind<V>(
    definitionId: string,
    requirements: UserContextRequirements,
    ownerId: string,
    signal: AbortSignal | undefined,
    writable: boolean,
  ): UserContextReader<V> | UserContextStore<V> {
    const contracts = this.#check(requirements)
    if (definitionId !== requirements.ownerId)
      throw new UserContextError(
        'unauthorized-owner',
        definitionId,
        'Mounted definition does not match the declared owner',
      )
    if (!writable && !contracts.has(ownerId))
      throw new UserContextError(
        'unsupported-contract',
        ownerId,
        'This definition did not declare this owner slice',
      )
    const generation = this.#generation
    const scopeSignal = this.#controller.signal
    const check = (): { entry: Entry; contract: StateContract } => {
      this.#assertGeneration(generation)
      if (signal?.aborted)
        throw new UserContextError('scope-disposed', ownerId, 'The mount has been disposed')
      const contract = contracts.get(ownerId)
      if (!contract)
        throw new UserContextError(
          'unsupported-contract',
          ownerId,
          'This definition did not declare this owner slice',
        )
      const entry = this.#entry(ownerId)
      if (entry.status === 'invalid') throw entry.error
      if (entry.status === 'absent' || entry.status === 'hydrating')
        throw new UserContextError(
          'not-ready',
          ownerId,
          'Await user-context preparation before reading or writing',
        )
      return { entry, contract }
    }
    const snapshot = (): Readonly<V> => {
      const { entry, contract } = check()
      const cached = entry.views.get(contract.revision)
      if (cached && cached.source === entry.confirmed) return cached.value as Readonly<V>
      const value = normalize(contract.node, entry.confirmed, ownerId, true)
      const json = stableJson(value)
      if (cached?.json === json) {
        entry.views.set(contract.revision, { ...cached, source: entry.confirmed })
        return cached.value as Readonly<V>
      }
      const result = immutable(value)
      entry.views.set(contract.revision, { json, value: result, source: entry.confirmed })
      return result as Readonly<V>
    }
    const field = (key: string): Entry => {
      const { entry, contract } = check()
      const node = objectNode(contract.node)
      if (!node || !Object.hasOwn(node.fields, key))
        throw new UserContextError(
          'unsupported-contract',
          ownerId,
          `Undeclared user-context field: ${key}`,
        )
      return entry
    }
    const observe = (listener: () => void): (() => void) => {
      const { entry } = check()
      entry.listeners.add(listener)
      const unsubscribe = (): void => {
        entry.listeners.delete(listener)
        signal?.removeEventListener('abort', unsubscribe)
        scopeSignal.removeEventListener('abort', unsubscribe)
      }
      signal?.addEventListener('abort', unsubscribe, { once: true })
      scopeSignal.addEventListener('abort', unsubscribe, { once: true })
      return unsubscribe
    }
    const reader: UserContextReader<V> = {
      get: key => {
        field(key)
        return snapshot()[key]
      },
      getSnapshot: snapshot,
      observe,
      subscribe: (key, listener) => {
        field(key)
        let previous = stableJson(snapshot()[key])
        let invalid = false
        return observe(() => {
          if (generation !== this.#generation || this.#disposed) {
            listener()
            return
          }
          let next: string
          try {
            next = stableJson(snapshot()[key])
          } catch {
            invalid = true
            listener()
            return
          }
          if (invalid || next !== previous) {
            invalid = false
            previous = next
            listener()
          }
        })
      },
    }
    if (!writable) return reader
    return {
      ...reader,
      set: async (key, value) => {
        try {
          const entry = field(key)
          assertJson(value, ownerId)
          const patch = { [key]: value }
          applyStateWrite(entry.canonical, entry.effective, patch)
          const accepted = new Promise<Json>((resolve, reject) => {
            entry.pending.push({
              expectedRevision: entry.recordRevision + entry.pending.length,
              operationId: `${this.#clientId}:${++this.#operation}`,
              value: immutable(structuredClone(patch)),
              resolve,
              reject,
            })
          })
          // effective is private queue validation state; readers and notifications use confirmed only.
          this.#replay(entry)
          this.#notifyInspection()
          void this.#flush(entry, generation)
          const canonical = await accepted
          return { ok: true, value: (canonical as Record<string, unknown>)[key] as V[typeof key] }
        } catch (error) {
          return {
            ok: false,
            error: isMfeError(error)
              ? error
              : new UserContextError('persistence-failed', ownerId, asError(error).message, {
                  cause: error,
                }),
          }
        }
      },
    }
  }

  /** The shell remounts affected definitions on identity/workspace changes. Old bindings fail closed. */
  setScope(scope: string): void {
    if (!scope || this.#disposed)
      throw new UserContextError(
        'scope-disposed',
        '<scope>',
        'A live runtime and nonempty scope are required',
      )
    if (scope === this.#scope) return
    this.#closeGeneration()
    this.#scope = scope
    this.#controller = new AbortController()
    this.#resetEntries()
    this.#listen()
    this.#notifyInspection()
  }
  dispose(): void {
    if (!this.#disposed) {
      this.#disposed = true
      this.#closeGeneration()
      this.#entries.clear()
      this.#notifyInspection()
      this.#inspectionListeners.clear()
    }
  }
  #closeGeneration(): void {
    ++this.#generation
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    for (const entry of this.#entries.values()) {
      for (const pending of entry.pending)
        pending.reject(
          new UserContextError(
            'scope-disposed',
            entry.canonical.id,
            'Scope changed during persistence',
          ),
        )
      entry.pending.length = 0
      // Diagnostics publish only after the new scope is fully installed.
      this.#notify(entry, false, true)
      entry.listeners.clear()
      entry.views.clear()
    }
    this.#controller.abort(
      new UserContextError('scope-disposed', '<scope>', 'Scope changed or runtime disposed'),
    )
  }
  #resetEntries(): void {
    this.#entries.clear()
    for (const canonical of this.#contracts.values())
      this.#entries.set(canonical.id, {
        canonical,
        status: 'absent',
        recordRevision: 0,
        confirmed: undefined,
        persisted: undefined,
        effective: undefined,
        views: new Map(),
        listeners: new Set(),
        pending: [],
      })
  }
  #listen(): void {
    const generation = this.#generation
    this.#unsubscribe = this.#options.adapter.subscribe?.(
      this.#scope,
      record => {
        if (this.#disposed || generation !== this.#generation) return
        const entry = this.#entries.get(record.id)
        if (!entry || record.revision <= entry.recordRevision) return
        try {
          this.#accept(entry, record)
          this.#replay(entry)
          this.#notify(entry)
        } catch (error) {
          this.#invalid(entry, error)
        }
      },
      this.#controller.signal,
    )
  }
  #check(requirements: UserContextRequirements): Map<string, StateContract> {
    this.#assertGeneration(this.#generation)
    if (!isRequirements(requirements))
      throw new UserContextError(
        'unsupported-contract',
        '<requirements>',
        'Shell must support user-context protocol 1',
      )
    const contracts = new Map<string, StateContract>()
    for (const requested of requirements.contracts) {
      if (
        !requested ||
        !isValidDefinitionId(requested.id) ||
        typeof requested.revision !== 'string' ||
        !requested.revision
      )
        throw new UserContextError(
          'unsupported-contract',
          '<requirements>',
          'Contract references need a valid owner ID and nonempty revision',
        )
      const contract = this.#contracts.get(requested.id)
      const capabilities = this.#capabilities.get(requested.id)
      if (!contract || !capabilities || contracts.has(requested.id))
        throw new UserContextError(
          'unsupported-contract',
          requested.id,
          'Owner is unavailable in deployment contracts or declared more than once',
        )
      const owned = requested.id === requirements.ownerId
      const declared: unknown = requested.capabilities
      const required =
        Array.isArray(declared) && declared.every(capability => typeof capability === 'string')
          ? owned
            ? declared
            : userContextReadCapabilities(declared)
          : []
      const available = owned ? capabilities.owned : capabilities.read
      if (!required.length || required.some(capability => !available.has(capability)))
        throw new UserContextError(
          'unsupported-contract',
          requested.id,
          'Deployment contract lacks required consumer fields or constraints; reload after upgrading the owner',
        )
      contracts.set(requested.id, contract)
    }
    return contracts
  }
  #entry(id: string): Entry {
    const entry = this.#entries.get(id)
    if (!entry)
      throw new UserContextError(
        'unsupported-contract',
        id,
        'No canonical owner contract in deployment metadata',
      )
    return entry
  }
  #assertGeneration(generation: number): void {
    if (this.#disposed || generation !== this.#generation)
      throw new UserContextError(
        'scope-disposed',
        '<scope>',
        'This binding belongs to a disposed scope',
      )
  }
  #hydrate(entry: Entry, generation: number): Promise<void> {
    if (entry.status === 'ready' || entry.status === 'persistence-failed') return Promise.resolve()
    if (entry.hydration) return entry.hydration
    entry.status = 'hydrating'
    this.#notifyInspection()
    entry.hydration = (async () => {
      try {
        const records = await abortable(
          this.#options.adapter.hydrate(this.#scope, [entry.canonical.id], this.#controller.signal),
          this.#controller.signal,
        )
        this.#assertGeneration(generation)
        if (records.length !== 1 || records[0]?.id !== entry.canonical.id)
          throw new UserContextError(
            'invalid-value',
            entry.canonical.id,
            'Hydration must return one explicit present/absent record per requested ID',
          )
        const record = records[0]
        // A subscription may already have delivered a newer record while hydrate was pending.
        if (entry.confirmed === undefined || record.revision > entry.recordRevision)
          this.#accept(entry, record)
        this.#replay(entry)
        entry.status = 'ready'
        this.#notify(entry)
      } catch (error) {
        if (generation === this.#generation && !this.#disposed) this.#invalid(entry, error)
        throw error
      } finally {
        delete entry.hydration
      }
    })()
    return entry.hydration
  }
  #accept(entry: Entry, record: StateRecord): void {
    if (
      record.id !== entry.canonical.id ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 0 ||
      (record.revision === 0) !== (record.value === undefined)
    )
      throw new UserContextError(
        'invalid-value',
        entry.canonical.id,
        'Invalid authoritative record envelope',
      )
    if (record.value !== undefined) assertJson(record.value, record.id)
    const value = normalize(entry.canonical.node, record.value, record.id)
    if (value === undefined)
      throw new UserContextError(
        'invalid-value',
        record.id,
        'Absent record needs a deterministic default; invalid data must be recovered explicitly',
      )
    if (record.revision < entry.recordRevision) return
    entry.confirmed = immutable(value)
    entry.persisted = immutable(structuredClone(record.value))
    entry.recordRevision = record.revision
    entry.status = 'ready'
    delete entry.error
  }
  #replay(entry: Entry): void {
    let value = entry.confirmed
    try {
      for (const pending of entry.pending)
        value = applyStateWrite(entry.canonical, value, pending.value)
    } catch (cause) {
      const failure = new UserContextError(
        'conflict',
        entry.canonical.id,
        'State changed and queued updates no longer have a valid base; refresh and choose again',
        { cause },
      )
      // A request already sent may have committed. Its own response settles that promise.
      const retained = entry.pending.filter(pending => this.#inflight.has(pending))
      for (const pending of entry.pending) if (!this.#inflight.has(pending)) pending.reject(failure)
      entry.pending.splice(0, entry.pending.length, ...retained)
      value = entry.confirmed
      this.#report(failure, entry.canonical.id)
    }
    entry.effective = immutable(value)
  }
  async #flush(entry: Entry, generation: number): Promise<void> {
    if (this.#sending.has(entry)) return
    this.#sending.add(entry)
    try {
      while (entry.pending.length && generation === this.#generation && !this.#disposed) {
        const pending = entry.pending[0]
        if (!pending) break
        try {
          this.#inflight.add(pending)
          const expectedRevision = pending.expectedRevision
          const record = await abortable(
            this.#options.adapter.write(
              {
                scope: this.#scope,
                id: entry.canonical.id,
                expectedRevision,
                operationId: pending.operationId,
                value: persistencePatch(
                  entry.persisted,
                  applyStateWrite(entry.canonical, entry.confirmed, pending.value),
                  pending.value,
                ),
              },
              this.#controller.signal,
            ),
            this.#controller.signal,
          )
          this.#assertGeneration(generation)
          if (record.revision <= expectedRevision)
            throw new UserContextError(
              'invalid-value',
              record.id,
              'Persistence acceptance must advance the record revision',
            )
          this.#accept(entry, record)
          this.#inflight.delete(pending)
          entry.pending.shift()
          this.#replay(entry)
          this.#notify(entry)
          pending.resolve(
            immutable(normalize(entry.canonical.node, record.value, record.id) as Json),
          )
        } catch (error) {
          this.#inflight.delete(pending)
          if (generation !== this.#generation || this.#disposed) return
          entry.pending.shift()
          pending.reject(error)
          // Every queued revision was formed assuming this intention succeeded. Never rebase
          // it onto a recovered state that may have changed under a different writer.
          const dependencyFailure = new UserContextError(
            'conflict',
            entry.canonical.id,
            'An earlier queued intention failed; refresh and choose the update again',
            { cause: error },
          )
          for (const queued of entry.pending.splice(0)) queued.reject(dependencyFailure)
          entry.effective = entry.confirmed
          entry.status = 'persistence-failed'
          entry.error = error
          this.#notifyInspection()
          this.#report(error, entry.canonical.id)
          // Refresh after rejection, including CAS conflicts; never retry this user intention.
          try {
            const records = await abortable(
              this.#options.adapter.hydrate(
                this.#scope,
                [entry.canonical.id],
                this.#controller.signal,
              ),
              this.#controller.signal,
            )
            this.#assertGeneration(generation)
            if (records.length !== 1 || !records[0])
              throw new UserContextError(
                'invalid-value',
                entry.canonical.id,
                'Recovery hydration returned no record',
              )
            this.#accept(entry, records[0])
            this.#replay(entry)
            this.#notify(entry)
          } catch (recovery) {
            if (generation !== this.#generation || this.#disposed) return
            // Reject queued intentions if their base cannot be validated/refreshed.
            for (const queued of entry.pending.splice(0)) queued.reject(recovery)
            this.#invalid(entry, recovery)
            return
          }
        }
      }
    } finally {
      this.#sending.delete(entry)
    }
  }
  #notifyInspection(): void {
    this.#inspectionSnapshot = undefined
    for (const listener of [...this.#inspectionListeners]) {
      try {
        listener()
      } catch (error) {
        this.#report(error, '<inspection>')
      }
    }
  }
  #notify(entry: Entry, inspection = true, force = false): void {
    if (inspection) this.#notifyInspection()
    const json = stableJson(entry.confirmed)
    const invalid = entry.status === 'invalid'
    if (!force && entry.notifiedJson === json && entry.notifiedInvalid === invalid) return
    entry.notifiedJson = json
    entry.notifiedInvalid = invalid
    for (const listener of [...entry.listeners]) {
      try {
        listener()
      } catch (error) {
        this.#report(error, entry.canonical.id)
      }
    }
  }
  #report(error: unknown, id: string): void {
    try {
      this.#options.onError?.(error, id)
    } catch {
      /* Reporting must not strand pending intentions. */
    }
  }
  #invalid(entry: Entry, error: unknown): void {
    entry.status = 'invalid'
    entry.error = isMfeError(error)
      ? error
      : new UserContextError('persistence-failed', entry.canonical.id, asError(error).message, {
          cause: error,
        })
    this.#report(entry.error, entry.canonical.id)
    this.#notify(entry)
  }
}
export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  if (signal.aborted) return Promise.reject(asError(signal.reason))
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(
        asError(
          signal.reason ?? new UserContextError('scope-disposed', '<scope>', 'Operation aborted'),
        ),
      )
    }
    signal.addEventListener('abort', abort, { once: true })
    work
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', abort)
      })
      .catch(() => undefined)
  })
}

function isRequirements(value: UserContextRequirements): boolean {
  return (
    !!value &&
    value.protocolVersion === 1 &&
    isValidDefinitionId(value.ownerId) &&
    Array.isArray(value.contracts)
  )
}
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value), { cause: value })
}

function objectNode(
  node: StateContract['node'],
): Extract<StateContract['node'], { kind: 'object' }> | undefined {
  if (node.kind === 'default') return objectNode(node.inner)
  return node.kind === 'object' ? node : undefined
}

/**
 * A schema-free backend cannot materialize defaults. Seed only missing branches that the client
 * validated from defaults; keep existing branches narrow so newer, unknown fields stay intact.
 * Called at send time, after earlier queued writes have established their accepted raw records.
 */
function persistencePatch(persisted: unknown, validated: Json, supplied: Json): Json {
  if (!isObject(supplied)) return structuredClone(validated)
  if (!isObject(persisted)) return structuredClone(validated)
  const next = validated as Record<string, Json>
  const patch: Record<string, Json> = {}
  for (const [key, value] of Object.entries(supplied)) {
    const selected = Object.hasOwn(next, key) ? next[key] : undefined
    // Domain validation may strip an undeclared key. It is never a persisted client intention.
    if (selected === undefined) continue
    Object.defineProperty(patch, key, {
      value: persistencePatch(
        Object.hasOwn(persisted, key) ? persisted[key] : undefined,
        selected,
        value,
      ),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return patch
}
