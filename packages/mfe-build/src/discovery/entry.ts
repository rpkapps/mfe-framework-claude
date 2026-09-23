/** Exactly one entry may exist; two would make "which file wins" a deployment question. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createBuildError } from '../diagnostics.ts'
import type { DefinitionSyntax } from './definitions.ts'

const ENTRY_MODULE_NAMES = ['src/mfe.ts', 'src/mfe.tsx'] as const

export function resolveEntryModule(
  containerRoot: string,
  syntax: Pick<DefinitionSyntax, 'appOptions'>,
): string {
  const present = ENTRY_MODULE_NAMES.map(name => join(containerRoot, name)).filter(file =>
    existsSync(file),
  )

  const first = present[0]
  if (first === undefined) {
    throw createBuildError({
      code: 'registry/invalid-entry',
      file: join(containerRoot, 'src/mfe.ts'),
      operation: 'find the container entry module',
      expected: 'src/mfe.ts, or src/mfe.tsx when the entry contains JSX',
      observed: 'neither file',
      declaredBy: 'Static discovery',
      repair: `Create src/mfe.ts and export the definitions this container provides, for example \`export const orders = createApp({ id: "orders", ${syntax.appOptions} })\`.`,
    })
  }

  if (present.length > 1) {
    throw createBuildError({
      code: 'registry/invalid-entry',
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
