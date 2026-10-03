import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { transformUserContextSource } from '../../packages/mfe-build/dist/user-context/transform.js'

/** Component tests use the same generated requirements and declaration transform as a build. */
export const userContextDeclarationsForTests = {
  name: 'user-context-declarations-for-tests',
  // Angular's compiler reads the file itself. Transform its output so it cannot restore the declaration.
  enforce: 'post',
  transform(source, id) {
    if (!id.endsWith('/src/mfe.ts') || !source.includes('userContext')) return undefined
    const references = resolve(dirname(id), '../.mfe/user-context.references.json')
    if (!existsSync(references))
      throw new Error(`Generate the container before testing: missing ${references}`)
    return {
      code: transformUserContextSource(source, id, JSON.parse(readFileSync(references, 'utf8'))),
      map: null,
    }
  },
}
