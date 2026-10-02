import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createUserContextBackend } from '@company/mfe-runtime/user-context'
import { schema } from './src/schema.js'

/** Single-process local example; production supplies an authenticated database repository. */
export function createDemoBackend(file) {
  let writes = Promise.resolve()
  async function readAll() {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw error
    }
  }
  const repository = {
    async read(scope, id, signal) {
      await writes
      signal.throwIfAborted()
      return (await readAll())[JSON.stringify([scope, id])]
    },
    transact(scope, id, update, signal) {
      const operation = writes.then(async () => {
        signal.throwIfAborted()
        const records = await readAll()
        const key = JSON.stringify([scope, id])
        const next = update(records[key])
        records[key] = next
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
  return createUserContextBackend({
    schema,
    repository,
    // This bounded demo endpoint grants only Lab writes. Never infer identity from a body or
    // arbitrary owner header; production resolves it from the authenticated server session.
    resolveOwner: async () => 'lab',
    authorize: async scope => {
      // This stand-in has no sign-in service. Only its isolated demo workspace is available.
      if (scope !== 'user-context-example') throw new Error('Unknown demo workspace')
    },
  })
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
