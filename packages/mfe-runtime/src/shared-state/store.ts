import {
  applyStateWrite,
  assertJson,
  immutable,
  normalize,
  SharedStateError,
  stableJson,
  type Json,
  type SharedStateAdapter,
  type SharedStateManifest,
  type SharedStateRequirements,
  type SharedStateService,
  type SharedStateStore,
  type StateContract,
  type StateRecord,
  type StateValues,
} from '@company/mfe-core/shared-state'

export interface SharedStateOptions {
  readonly scope: string
  /** Latest compiled schema; compatibility history stays in build/release tooling. */
  readonly schema: SharedStateManifest
  readonly adapter: SharedStateAdapter
  readonly onError?: (error: unknown, id: string) => void
}
interface Pending {
  readonly expectedRevision: number
  readonly operationId: string
  readonly value: Json
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}
interface Entry {
  readonly canonical: StateContract
  status: 'absent' | 'hydrating' | 'ready' | 'invalid' | 'persistence-failed'
  recordRevision: number
  confirmed: Json | undefined
  effective: Json | undefined
  error?: unknown
  readonly views: Map<
    string,
    { readonly json: string; readonly value: unknown; readonly source: Json | undefined }
  >
  readonly listeners: Set<() => void>
  readonly pending: Pending[]
  hydration?: Promise<void>
}

/** Shell-owned, independent of module identity. Bindings capture a scope generation. */
export class SharedStateRuntime implements SharedStateService {
  readonly protocolVersion = 1
  readonly #options: SharedStateOptions
  readonly #contracts = new Map<string, StateContract>()
  readonly #entries = new Map<string, Entry>()
  readonly #sending = new Set<Entry>()
  #scope: string
  #generation = 0
  #controller = new AbortController()
  #unsubscribe: (() => void) | undefined
  #disposed = false
  #operation = 0
  readonly #clientId = crypto.randomUUID()

  constructor(options: SharedStateOptions) {
    this.#options = options
    this.#scope = options.scope
    if (!options.scope || options.schema.formatVersion !== 1)
      throw new SharedStateError(
        'unsupported-contract',
        '<schema>',
        'Configure a nonempty opaque scope and contract format 1',
      )
    for (const contract of options.schema.contracts) {
      if (contract.formatVersion !== 1 || this.#contracts.has(contract.id))
        throw new SharedStateError(
          'unsupported-contract',
          contract.id,
          'Schema needs one current contract per state ID in format 1',
        )
      this.#contracts.set(contract.id, immutable(structuredClone(contract)))
    }
    this.#resetEntries()
    this.#listen()
  }

  async prepare(requirements: SharedStateRequirements, signal?: AbortSignal): Promise<void> {
    const generation = this.#generation
    this.#check(requirements)
    const hydration = Promise.all(
      requirements.contracts.map(({ id }) => this.#hydrate(this.#entry(id), generation)),
    )
    await abortable(hydration, signal)
    this.#assertGeneration(generation)
  }

  bind<V = StateValues>(
    requirements: SharedStateRequirements,
    signal?: AbortSignal,
  ): SharedStateStore<V> {
    const contracts = this.#check(requirements)
    const generation = this.#generation
    const check = (key: string): { entry: Entry; contract: StateContract } => {
      this.#assertGeneration(generation)
      if (signal?.aborted)
        throw new SharedStateError('scope-disposed', key, 'The mount has been disposed')
      const contract = contracts.get(key)
      if (!contract)
        throw new SharedStateError(
          'unsupported-contract',
          key,
          'This definition did not declare this shared-state ID',
        )
      const entry = this.#entry(key)
      if (entry.status === 'invalid') throw entry.error
      if (entry.status === 'absent' || entry.status === 'hydrating')
        throw new SharedStateError(
          'not-ready',
          key,
          'Await shared-state preparation before reading or writing',
        )
      return { entry, contract }
    }
    return {
      get: key => {
        const { entry, contract } = check(key)
        const cached = entry.views.get(contract.revision)
        if (cached && cached.source === entry.effective) return cached.value as V[typeof key]
        const value = normalize(contract.node, entry.effective, key, true)
        const json = stableJson(value)
        if (cached?.json === json) {
          entry.views.set(contract.revision, { ...cached, source: entry.effective })
          return cached.value as V[typeof key]
        }
        const snapshot = immutable(value)
        entry.views.set(contract.revision, { json, value: snapshot, source: entry.effective })
        return snapshot as V[typeof key]
      },
      set: (key, value) => {
        // Return a rejected promise for validation errors while still publishing success synchronously.
        try {
          const { entry } = check(key)
          assertJson(value, key)
          const next = applyStateWrite(entry.canonical, entry.effective, value)
          const accepted = new Promise<void>((resolve, reject) => {
            entry.pending.push({
              expectedRevision: entry.recordRevision + entry.pending.length,
              operationId: `${this.#clientId}:${++this.#operation}`,
              value: immutable(structuredClone(value)),
              resolve,
              reject,
            })
          })
          entry.effective = immutable(next)
          this.#notify(entry)
          void this.#flush(entry, generation)
          return accepted
        } catch (error) {
          return Promise.reject(asError(error))
        }
      },
      subscribe: (key, listener) => {
        const { entry } = check(key)
        entry.listeners.add(listener)
        const unsubscribe = (): void => {
          entry.listeners.delete(listener)
          signal?.removeEventListener('abort', unsubscribe)
        }
        signal?.addEventListener('abort', unsubscribe, { once: true })
        return unsubscribe
      },
    }
  }

  /** The shell remounts affected definitions on identity/workspace changes. Old bindings fail closed. */
  setScope(scope: string): void {
    if (!scope || this.#disposed)
      throw new SharedStateError(
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
  }
  dispose(): void {
    if (!this.#disposed) {
      this.#disposed = true
      this.#closeGeneration()
      this.#entries.clear()
    }
  }
  #closeGeneration(): void {
    ++this.#generation
    this.#controller.abort(
      new SharedStateError('scope-disposed', '<scope>', 'Scope changed or runtime disposed'),
    )
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    for (const entry of this.#entries.values()) {
      for (const pending of entry.pending)
        pending.reject(
          new SharedStateError(
            'scope-disposed',
            entry.canonical.id,
            'Scope changed during persistence',
          ),
        )
      entry.pending.length = 0
      this.#notify(entry)
      entry.listeners.clear()
    }
  }
  #resetEntries(): void {
    this.#entries.clear()
    for (const canonical of this.#options.schema.contracts) {
      if (this.#entries.has(canonical.id))
        throw new SharedStateError(
          'unsupported-contract',
          canonical.id,
          'Duplicate canonical state ID',
        )
      this.#entries.set(canonical.id, {
        canonical: this.#contracts.get(canonical.id) ?? canonical,
        status: 'absent',
        recordRevision: 0,
        confirmed: undefined,
        effective: undefined,
        views: new Map(),
        listeners: new Set(),
        pending: [],
      })
    }
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
  #check(requirements: SharedStateRequirements): Map<string, StateContract> {
    this.#assertGeneration(this.#generation)
    if (!isRequirements(requirements))
      throw new SharedStateError(
        'unsupported-contract',
        '<requirements>',
        'Shell must support shared-state protocol 1',
      )
    const contracts = new Map<string, StateContract>()
    for (const requested of requirements.contracts) {
      const contract = this.#contracts.get(requested.id)
      if (!contract || !this.#entries.has(requested.id) || contracts.has(requested.id))
        throw new SharedStateError(
          'unsupported-contract',
          requested.id,
          'State ID is unavailable in the shell schema or declared more than once',
        )
      contracts.set(requested.id, contract)
    }
    return contracts
  }
  #entry(id: string): Entry {
    const entry = this.#entries.get(id)
    if (!entry)
      throw new SharedStateError(
        'unsupported-contract',
        id,
        'No canonical contract in shell schema',
      )
    return entry
  }
  #assertGeneration(generation: number): void {
    if (this.#disposed || generation !== this.#generation)
      throw new SharedStateError(
        'scope-disposed',
        '<scope>',
        'This binding belongs to a disposed scope',
      )
  }
  #hydrate(entry: Entry, generation: number): Promise<void> {
    if (entry.status === 'ready' || entry.status === 'persistence-failed') return Promise.resolve()
    if (entry.hydration) return entry.hydration
    entry.status = 'hydrating'
    entry.hydration = (async () => {
      try {
        const records = await abortable(
          this.#options.adapter.hydrate(this.#scope, [entry.canonical.id], this.#controller.signal),
          this.#controller.signal,
        )
        this.#assertGeneration(generation)
        if (records.length !== 1 || records[0]?.id !== entry.canonical.id)
          throw new SharedStateError(
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
      throw new SharedStateError(
        'invalid-value',
        entry.canonical.id,
        'Invalid authoritative record envelope',
      )
    if (record.revision < entry.recordRevision) return
    if (record.value !== undefined) assertJson(record.value, record.id)
    const value = normalize(entry.canonical.node, record.value, record.id)
    if (value === undefined)
      throw new SharedStateError(
        'invalid-value',
        record.id,
        'Absent record needs a deterministic default; invalid data must be recovered explicitly',
      )
    entry.confirmed = immutable(value)
    entry.recordRevision = record.revision
    entry.status = 'ready'
    delete entry.error
  }
  #replay(entry: Entry): void {
    let value = entry.confirmed
    for (const pending of entry.pending)
      value = applyStateWrite(entry.canonical, value, pending.value)
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
          const expectedRevision = pending.expectedRevision
          const record = await abortable(
            this.#options.adapter.write(
              {
                scope: this.#scope,
                id: entry.canonical.id,
                expectedRevision,
                operationId: pending.operationId,
                value: pending.value,
              },
              this.#controller.signal,
            ),
            this.#controller.signal,
          )
          this.#assertGeneration(generation)
          if (record.revision <= expectedRevision)
            throw new SharedStateError(
              'invalid-value',
              record.id,
              'Persistence acceptance must advance the record revision',
            )
          this.#accept(entry, record)
          entry.pending.shift()
          this.#replay(entry)
          this.#notify(entry)
          pending.resolve()
        } catch (error) {
          if (generation !== this.#generation || this.#disposed) return
          entry.pending.shift()
          pending.reject(error)
          entry.status = 'persistence-failed'
          entry.error = error
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
              throw new SharedStateError(
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
  #notify(entry: Entry): void {
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
    entry.error = error
    this.#report(error, entry.canonical.id)
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
          signal.reason ?? new SharedStateError('scope-disposed', '<scope>', 'Operation aborted'),
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

function isRequirements(value: SharedStateRequirements): boolean {
  return value.protocolVersion === 1 && Array.isArray(value.contracts)
}
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value), { cause: value })
}
