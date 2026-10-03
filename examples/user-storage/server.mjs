import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

// Matches the shell's local demo identity; production reads the user from its authenticated session.
export const DEMO_USER = 'u-2841'

/** A definition id, or the shell's own `@host` owner. */
const OWNER = /^(?:@host|[a-z0-9]+(?:-[a-z0-9]+)*)$/
/** A key name, with `@<instanceId>` for a perInstance key. */
const KEY = /^[^:@]+(?:@.+)?$/

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function own(map, name) {
  return Object.hasOwn(map, name) ? map[name] : undefined
}

class DemoStorageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DemoStorageError'
    this.status = 400
  }
}

function assertRow(owner, key) {
  if (typeof owner !== 'string' || !OWNER.test(owner))
    throw new DemoStorageError(`Unknown owner ${JSON.stringify(owner)}`)
  if (typeof key !== 'string' || key.length === 0 || key.length > 256 || !KEY.test(key))
    throw new DemoStorageError(`Invalid key ${JSON.stringify(key)}`)
}

function assertValue(value) {
  if (value === null) return
  if (!isMap(value) || !Number.isInteger(value.v) || value.v < 1 || !Object.hasOwn(value, 'd'))
    throw new DemoStorageError('A stored value is { v, d } with an integer schema version v')
  // A browser-supplied identity is never accepted; the server decides whose row this is.
  if (Object.keys(value).some(field => field !== 'v' && field !== 'd'))
    throw new DemoStorageError('A stored value carries only v and d')
}

/**
 * Single-process local example of the user storage table: one row of `{ v, d, revision }` per
 * user, owner and key. Production supplies an authenticated, transactional database.
 */
export function createDemoBackend(file) {
  let writes = Promise.resolve()

  async function readAll() {
    try {
      const persisted = JSON.parse(await readFile(file, 'utf8'))
      if (!isMap(persisted)) throw new Error('Invalid demo storage document')
      return persisted
    } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw error
    }
  }

  async function persist(records) {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(JSON.stringify(records))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, file)
    if (process.platform !== 'win32') {
      const directory = await open(dirname(file), 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    }
  }

  return {
    /** Everything stored for `user`: owner, then key, then row. */
    async load(user, signal) {
      await writes
      signal.throwIfAborted()
      return own(await readAll(), user) ?? {}
    },

    /** Stores one key, bumping its revision; `null` removes it. Resolves with the row, or null. */
    save(user, owner, key, value, signal) {
      try {
        assertRow(owner, key)
        assertValue(value)
      } catch (error) {
        return Promise.reject(error)
      }
      const operation = writes.then(async () => {
        signal.throwIfAborted()
        const records = await readAll()
        const owners = own(records, user) ?? {}
        const { [key]: previous, ...others } = own(owners, owner) ?? {}
        // Computed keys define their own property, so a key named `__proto__` stays a plain row.
        const row =
          value === null
            ? null
            : {
                v: value.v,
                d: value.d,
                // Revisions only grow, also across a removal, so a stale copy never wins later.
                revision: Math.max((previous?.revision ?? 0) + 1, Date.now()),
              }
        const keys = row === null ? others : { ...others, [key]: row }
        const next = { ...owners }
        delete next[owner]
        if (Object.keys(keys).length > 0) next[owner] = keys
        await persist({ ...records, [user]: next })
        return row
      })
      writes = operation.then(
        () => undefined,
        () => undefined,
      )
      return operation
    },
  }
}

export async function readRequestBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 65536) throw new DemoStorageError('User storage example request exceeds 64 KiB')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new DemoStorageError('User storage requests carry JSON')
  }
}
