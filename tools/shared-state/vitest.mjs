import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { transformSharedStateSource } from '../../packages/mfe-build/dist/shared-state/transform.js'

/** Component tests use the same generated requirements and declaration transform as a build. */
export const sharedStateDeclarationsForTests = {
  name: 'shared-state-declarations-for-tests',
  // Angular's compiler reads the file itself. Transform its output so it cannot restore the declaration.
  enforce: 'post',
  transform(source, id) {
    if (!id.endsWith('/src/mfe.ts') || !source.includes('sharedStateSchema')) return undefined
    const references = resolve(dirname(id), '../.mfe/shared-state.references.json')
    if (!existsSync(references))
      throw new Error(`Generate the container before testing: missing ${references}`)
    return {
      code: transformSharedStateSource(source, id, JSON.parse(readFileSync(references, 'utf8'))),
      map: null,
    }
  },
}
