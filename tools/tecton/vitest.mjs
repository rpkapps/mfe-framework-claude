/**
 * What a Vitest project needs in order to render design-system components: `@tecton/react` is a
 * `link:` to a sibling checkout whose own React would otherwise be a second copy.
 */

import { createRequire } from 'node:module'
import { dirname } from 'node:path'

/** Resolved from the shell, the only package here that declares every one of these. */
const fromShell = createRequire(new URL('../../apps/shell/package.json', import.meta.url))

/** Packages that carry React context, where a second copy is the same failure as React's own. */
export const SINGLE_COPY = [
  'react',
  'react-dom',
  'react-aria',
  'react-aria-components',
  '@base-ui/react',
  '@tanstack/react-router',
  '@tanstack/react-query',
  '@tanstack/react-table',
  'lucide-react',
  'sonner',
  'next-themes',
  'react-resizable-panels',
  'recharts',
]

/** Externalized, they would keep Node's resolution and find the linked checkout's own React. */
export const INLINE_DEPS = [
  /tecton-ui-1/,
  /lucide-react/,
  /react-aria/,
  /@react-(aria|stately|types)/,
]

/** `dedupe` alone resolves from the project root, where these projects have no `node_modules`. */
export const singleCopyAliases = SINGLE_COPY.flatMap(name => {
  // A package only the design system depends on has one copy already.
  let directory
  try {
    directory = dirname(fromShell.resolve(`${name}/package.json`))
  } catch {
    return []
  }
  return [
    { find: new RegExp(`^${name.replace('/', '\\/')}$`), replacement: directory },
    { find: new RegExp(`^${name.replace('/', '\\/')}\\/`), replacement: `${directory}/` },
  ]
})

export const tectonResolveForTests = { dedupe: SINGLE_COPY, alias: singleCopyAliases }

export const tectonServerForTests = { deps: { inline: INLINE_DEPS } }
