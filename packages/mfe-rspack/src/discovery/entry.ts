/**
 * Locating the one module the build reads definitions from.
 *
 * Discovery is deliberately not a repository scan. A container declares its
 * definitions in a designated entry — `src/mfe.ts`, or `src/mfe.tsx` when the
 * entry itself contains JSX — and nowhere else. Two entries would make "which
 * file wins" a deployment question, so exactly one may exist.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createBuildError } from '../diagnostics.ts'

/** The designated entry module names, in the order they are reported. */
export const ENTRY_MODULE_NAMES = ['src/mfe.ts', 'src/mfe.tsx'] as const

export function resolveEntryModule(containerRoot: string): string {
  const present = ENTRY_MODULE_NAMES.map(name => join(containerRoot, name)).filter(file =>
    existsSync(file),
  )

  const first = present[0]
  if (first === undefined) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: join(containerRoot, 'src/mfe.ts'),
      operation: 'find the container entry module',
      expected: 'src/mfe.ts, or src/mfe.tsx when the entry contains JSX',
      observed: 'neither file',
      declaredBy: 'Static discovery',
      repair:
        'Create src/mfe.ts and export the definitions this container provides, for example `export const orders = createApp({ id: "orders", router: makeRouter })`.',
    })
  }

  if (present.length > 1) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: first,
      operation: 'find the container entry module',
      expected: 'exactly one entry module',
      observed: 'both src/mfe.ts and src/mfe.tsx',
      declaredBy: 'Static discovery',
      repair:
        'Delete one of them. Keep src/mfe.tsx only when the entry itself contains JSX; otherwise keep src/mfe.ts.',
    })
  }

  return first
}
