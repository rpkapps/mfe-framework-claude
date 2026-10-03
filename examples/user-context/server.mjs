import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createUserContextBackend } from '@company/mfe-runtime/user-context'

// Matches the shell's local demo identity; production derives this from its authenticated session.
export const DEMO_SCOPE = JSON.stringify([null, null, 'u-2841'])

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Single-process local example; production supplies an authenticated database repository. */
export function createDemoBackend(file) {
  let writes = Promise.resolve()
  async function readAll() {
    try {
      const persisted = JSON.parse(await readFile(file, 'utf8'))
      if (!isMap(persisted) || !isMap(persisted.documents) || !isMap(persisted.metadata))
        throw new Error('Invalid demo storage document')
      return persisted
    } catch (error) {
      if (error.code === 'ENOENT') return { documents: {}, metadata: {} }
      throw error
    }
  }
  function stored(records, scope, id) {
    const document = Object.hasOwn(records.documents, scope) ? records.documents[scope] : undefined
    const ownerMetadata = Object.hasOwn(records.metadata, scope)
      ? records.metadata[scope]
      : undefined
    const metadata =
      ownerMetadata !== undefined && Object.hasOwn(ownerMetadata, id)
        ? ownerMetadata[id]
        : undefined
    if (metadata === undefined && (document === undefined || !Object.hasOwn(document, id)))
      return undefined
    if (metadata === undefined || document === undefined || !Object.hasOwn(document, id))
      throw new Error('Incomplete persisted user-context record')
    return { ...metadata, value: document[id] }
  }
  const repository = {
    async read(scope, id, signal) {
      await writes
      signal.throwIfAborted()
      return stored(await readAll(), scope, id)
    },
    transact(scope, id, update, signal) {
      const operation = writes.then(async () => {
        signal.throwIfAborted()
        const records = await readAll()
        const next = update(stored(records, scope, id))
        // Values form an opaque document per user. CAS and retry metadata stay separate.
        records.documents[scope] = { ...records.documents[scope], [id]: next.value }
        records.metadata[scope] = {
          ...records.metadata[scope],
          [id]: { revision: next.revision, receipts: next.receipts },
        }
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
        return next
      })
      writes = operation.then(
        () => undefined,
        () => undefined,
      )
      return operation
    },
  }
  const owners = new Set(['lab', 'well-inspection', 'shell'])
  const backends = new Map()
  function forOwner(owner) {
    if (!owners.has(owner)) throw new Error('Unknown demo owner')
    if (!backends.has(owner)) {
      backends.set(
        owner,
        createUserContextBackend({
          repository,
          // Each dev API route selects a fixed owner; submitted record IDs cannot change it.
          // These endpoints are public local-demo capabilities, not production authentication.
          resolveOwner: async () => owner,
          authorize: async scope => {
            if (scope !== DEMO_SCOPE) throw new Error('Unknown demo identity')
          },
        }),
      )
    }
    return backends.get(owner)
  }
  return { ...forOwner('lab'), forOwner }
}

export async function readRequestBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 65536) throw new Error('User-context example request exceeds 64 KiB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
