import type { z } from 'zod'
import { isValidDefinitionId } from '@company/mfe-core/definition'
import { isMfeError } from '@company/mfe-core/errors'
import {
  assertJson,
  immutable,
  isObject,
  mergeStateValue,
  stableJson,
  UserContextError,
  type Json,
  type StateRecord,
  type StateValues,
  type UserContextAdapter,
  type UserContextInspection,
  type UserContextInspectionSnapshot,
  type UserContextOwner,
  type UserContextReader,
  type UserContextService,
  type UserContextStatus,
  type UserContextStore,
} from '@company/mfe-core/user-context'

export interface UserContextOptions {
  readonly adapter: UserContextAdapter
  readonly onError?: (error: unknown, id: string) => void
}
interface Entry {
  readonly id: string
  status: UserContextStatus
  revision: number
  /** The stored record; each binding parses it with the schema it declared. */
  value: Json | undefined
  error?: unknown
  hydration?: Promise<void>
  /** An owner's writes go out one at a time, so the server merges them in the order they were made. */
  writes: Promise<unknown>
  readonly listeners: Set<() => void>
  readonly views: WeakMap<z.ZodType, { readonly source: Json | undefined; readonly value: unknown }>
}

/**
 * Shell-owned, one per signed-in user: `reset()` starts over when the user changes, and every
 * binding, request and subscription of the previous user fails closed through the generation and
 * the abort signal it captured.
 */
export class UserContextRuntime implements UserContextService {
  readonly #options: UserContextOptions
  readonly #entries = new Map<string, Entry>()
  /** Owner schemas this page has seen, which validate their records whoever reads them. */
  readonly #schemas = new Map<string, z.ZodObject>()
  readonly #jsonSchemas = new WeakMap<z.ZodType, Json | undefined>()
  #generation = 0
  #controller = new AbortController()
  #unsubscribe: (() => void) | undefined
  #disposed = false
  readonly #inspectionListeners = new Set<() => void>()
  #inspectionSnapshot: UserContextInspectionSnapshot | undefined

  readonly inspection: UserContextInspection = {
    getSnapshot: () => {
      this.#inspectionSnapshot ??= Object.freeze({
        generation: this.#generation,
        disposed: this.#disposed,
        entries: Object.freeze(
          [...this.#entries.values()].map(entry =>
            Object.freeze({
              id: entry.id,
              status: entry.status,
              revision: entry.revision,
              value: entry.value,
              schema: this.#jsonSchema(entry.id),
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
  }

  async prepare(owner: UserContextOwner, signal?: AbortSignal): Promise<void> {
    const generation = this.#generation
    this.#assertGeneration(generation)
    const declaration = owner.userContext
    const ids = Object.keys(declaration?.reads ?? {})
    for (const id of ids)
      if (!isValidDefinitionId(id) || id === owner.id)
        throw new UserContextError(
          'undeclared',
          owner.id,
          `userContext.reads names '${id}'; read other definitions by their ID and your own slice through schema`,
        )
    if (declaration?.schema) {
      this.#schemas.set(owner.id, declaration.schema)
      ids.push(owner.id)
    }
    if (!ids.length) return
    this.#listen()
    await abortable(Promise.all(ids.map(id => this.#hydrate(this.#entry(id), generation))), signal)
    this.#assertGeneration(generation)
  }

  bind<V = StateValues>(owner: UserContextOwner, signal?: AbortSignal): UserContextStore<V> {
    const schema = owner.userContext?.schema
    if (!schema)
      throw new UserContextError(
        'undeclared',
        owner.id,
        'Declare userContext.schema before reading or writing your own slice',
      )
    return this.#bind<V>(owner.id, schema, signal, true) as UserContextStore<V>
  }

  bindReadOnly<V = StateValues>(
    owner: UserContextOwner,
    ownerId: string,
    signal?: AbortSignal,
  ): UserContextReader<V> {
    const reads = owner.userContext?.reads
    const schema = reads && Object.hasOwn(reads, ownerId) ? reads[ownerId] : undefined
    if (!schema || ownerId === owner.id)
      throw new UserContextError(
        'undeclared',
        ownerId,
        `${owner.id} did not declare userContext.reads['${ownerId}']; declare the fields it reads`,
      )
    return this.#bind<V>(ownerId, schema, signal, false)
  }

  /** The shell calls this when the signed-in user changes, then remounts what it shows. */
  reset(): void {
    if (this.#disposed) return
    this.#closeGeneration()
    this.#controller = new AbortController()
    this.#notifyInspection()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#closeGeneration()
    this.#notifyInspection()
    this.#inspectionListeners.clear()
  }

  #bind<V>(
    ownerId: string,
    schema: z.ZodObject,
    signal: AbortSignal | undefined,
    writable: boolean,
  ): UserContextReader<V> | UserContextStore<V> {
    this.#assertGeneration(this.#generation)
    const generation = this.#generation
    const scopeSignal = this.#controller.signal
    const check = (): Entry => {
      this.#assertGeneration(generation)
      if (signal?.aborted)
        throw new UserContextError('scope-disposed', ownerId, 'The mount has been disposed')
      const entry = this.#entries.get(ownerId)
      if (entry?.status === 'invalid') throw entry.error
      if (entry?.status !== 'ready')
        throw new UserContextError(
          'not-ready',
          ownerId,
          'Await user-context preparation before reading or writing',
        )
      return entry
    }
    const snapshot = (): Readonly<V> => {
      const entry = check()
      const cached = entry.views.get(schema)
      if (cached && cached.source === entry.value) return cached.value as Readonly<V>
      const value = parse(schema, entry.value ?? {}, ownerId, READ_REPAIR)
      // A record that changed elsewhere can leave this binding's fields as they were.
      const kept =
        cached && stableJson(cached.value) === stableJson(value) ? cached.value : immutable(value)
      entry.views.set(schema, { source: entry.value, value: kept })
      return kept as Readonly<V>
    }
    const field = (key: string): Entry => {
      const entry = check()
      if (!Object.hasOwn(schema.shape, key))
        throw new UserContextError(
          'undeclared',
          ownerId,
          `'${key}' is not a field of the declared schema; add it to the schema first`,
        )
      return entry
    }
    const observe = (listener: () => void): (() => void) => {
      const entry = check()
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
        let previous: string | undefined = stableJson(snapshot()[key])
        return observe(() => {
          let next: string | undefined
          try {
            next = stableJson(snapshot()[key])
          } catch {
            // A reset or an invalid record: the listener reads again and meets the error.
            next = undefined
          }
          if (next === undefined || next !== previous) {
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
          // A nested update fills in the rest of the key from what this tab reads, so the key is
          // sent whole and the server can replace it: the last write of a key wins.
          const patch = { [key]: mergeStateValue(snapshot()[key], value) }
          parse(
            schema,
            { ...(isObject(entry.value) ? entry.value : {}), ...patch },
            ownerId,
            WRITE_REPAIR,
          )
          await this.#write(entry, patch, generation)
          return { ok: true, value: snapshot()[key] }
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

  #write(entry: Entry, patch: Record<string, Json>, generation: number): Promise<void> {
    const send = async (): Promise<void> => {
      this.#assertGeneration(generation)
      try {
        const record = await abortable(
          this.#options.adapter.write({ id: entry.id, value: patch }, this.#controller.signal),
          this.#controller.signal,
        )
        this.#assertGeneration(generation)
        if (record.id !== entry.id || record.revision < 1 || record.value === undefined)
          throw new UserContextError(
            'persistence-failed',
            entry.id,
            'A write must resolve with the stored record and its new revision',
          )
        this.#accept(entry, record)
      } catch (error) {
        if (generation === this.#generation && !this.#disposed) {
          this.#report(error, entry.id)
          // The server may hold something other than what this tab last saw, so read it again.
          void this.#load(entry, generation).catch((failure: unknown) => {
            if (generation === this.#generation && !this.#disposed) this.#invalid(entry, failure)
          })
        }
        throw error
      }
    }
    const written = entry.writes.then(send, send)
    entry.writes = written.catch(() => undefined)
    return written
  }

  #listen(): void {
    if (this.#unsubscribe) return
    const generation = this.#generation
    this.#unsubscribe =
      this.#options.adapter.subscribe?.(record => {
        if (this.#disposed || generation !== this.#generation) return
        const entry = this.#entries.get(record.id)
        if (!entry) return
        try {
          this.#accept(entry, record)
        } catch (error) {
          this.#invalid(entry, error)
        }
      }, this.#controller.signal) ?? (() => {})
  }

  #closeGeneration(): void {
    ++this.#generation
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    const entries = [...this.#entries.values()]
    this.#entries.clear()
    // Listeners read again and meet scope-disposed, so nothing keeps the previous user's data.
    for (const entry of entries) this.#notify(entry)
    this.#controller.abort(
      new UserContextError('scope-disposed', '<user>', 'The signed-in user changed'),
    )
  }

  #entry(id: string): Entry {
    let entry = this.#entries.get(id)
    if (!entry) {
      entry = {
        id,
        status: 'hydrating',
        revision: 0,
        value: undefined,
        writes: Promise.resolve(),
        listeners: new Set(),
        views: new WeakMap(),
      }
      this.#entries.set(id, entry)
    }
    return entry
  }

  #assertGeneration(generation: number): void {
    if (this.#disposed || generation !== this.#generation)
      throw new UserContextError(
        'scope-disposed',
        '<user>',
        'This binding belongs to a previous signed-in user or a disposed runtime',
      )
  }

  /** A failed owner loads again, so the next mount or shell preparation can recover. */
  #hydrate(entry: Entry, generation: number): Promise<void> {
    if (entry.status === 'ready') return Promise.resolve()
    entry.hydration ??= this.#load(entry, generation)
      .catch((error: unknown) => {
        if (generation === this.#generation && !this.#disposed) this.#invalid(entry, error)
        throw error
      })
      .finally(() => {
        delete entry.hydration
      })
    return entry.hydration
  }

  async #load(entry: Entry, generation: number): Promise<void> {
    const records = await abortable(
      this.#options.adapter.hydrate([entry.id], this.#controller.signal),
      this.#controller.signal,
    )
    this.#assertGeneration(generation)
    const record = records[0]
    if (records.length !== 1 || record?.id !== entry.id)
      throw new UserContextError(
        'persistence-failed',
        entry.id,
        'Hydration must return one record per requested ID, with revision 0 when it is absent',
      )
    this.#accept(entry, record, true)
  }

  /**
   * Only a newer revision replaces what is held, so a late response cannot move it back. Throws
   * when the record is malformed or the owner's schema rejects it.
   */
  #accept(entry: Entry, record: StateRecord, hydrating = false): void {
    if (record.revision < entry.revision || (record.revision === entry.revision && !hydrating))
      return
    if (
      !Number.isSafeInteger(record.revision) ||
      record.revision < 0 ||
      (record.revision === 0) !== (record.value === undefined)
    )
      throw new UserContextError('invalid-value', entry.id, 'Invalid stored record envelope')
    if (record.value !== undefined) {
      assertJson(record.value, entry.id)
      if (!isObject(record.value))
        throw new UserContextError('invalid-value', entry.id, 'A stored record must be an object')
    }
    const schema = this.#schemas.get(entry.id)
    if (schema) parse(schema, record.value ?? {}, entry.id, READ_REPAIR)
    const changed = entry.status !== 'ready' || stableJson(entry.value) !== stableJson(record.value)
    entry.value = record.value === undefined ? undefined : immutable(structuredClone(record.value))
    entry.revision = record.revision
    entry.status = 'ready'
    delete entry.error
    if (changed) this.#notify(entry)
    else this.#notifyInspection()
  }

  #jsonSchema(id: string): Json | undefined {
    const schema = this.#schemas.get(id)
    if (!schema) return undefined
    if (!this.#jsonSchemas.has(schema)) {
      let json: Json | undefined
      try {
        // The schema's own method, so a container's schema is read by the Zod that made it.
        json = immutable(schema.toJSONSchema({ io: 'input', unrepresentable: 'any' }) as Json)
      } catch {
        json = undefined
      }
      this.#jsonSchemas.set(schema, json)
    }
    return this.#jsonSchemas.get(schema)
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

  #notify(entry: Entry): void {
    this.#notifyInspection()
    for (const listener of [...entry.listeners]) {
      try {
        listener()
      } catch (error) {
        this.#report(error, entry.id)
      }
    }
  }

  #report(error: unknown, id: string): void {
    try {
      this.#options.onError?.(error, id)
    } catch {
      /* Reporting must not strand a write. */
    }
  }

  #invalid(entry: Entry, error: unknown): void {
    entry.status = 'invalid'
    entry.error = isMfeError(error)
      ? error
      : new UserContextError('persistence-failed', entry.id, asError(error).message, {
          cause: error,
        })
    this.#report(entry.error, entry.id)
    this.#notify(entry)
  }
}

const READ_REPAIR =
  'Give a field the owner may not have written yet a default, or make it optional or nullable'
const WRITE_REPAIR = 'Pass a value the owner schema accepts'

/** Parse with a declared schema; the result must stay JSON, so a transform to `Date` is refused. */
function parse(schema: z.ZodType, value: unknown, id: string, repair: string): unknown {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new UserContextError(
      'invalid-value',
      id,
      `${result.error.issues
        .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}. ${repair}`,
      { cause: result.error },
    )
  assertJson(result.data, id)
  return result.data
}

export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  if (signal.aborted) return Promise.reject(asError(signal.reason))
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(
        asError(
          signal.reason ?? new UserContextError('scope-disposed', '<user>', 'Operation aborted'),
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

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value), { cause: value })
}
