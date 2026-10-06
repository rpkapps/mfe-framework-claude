/**
 * What a Vitest project needs in order to render design-system components: `@tecton/react` is a
 * `link:` to a sibling checkout whose own React would otherwise be a second copy.
 */

import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sourceResolveForTests } from '../workspace/conditions.mjs'
import { tectonCheckoutDirectory } from './location.mjs'

/** Packages that carry React context, where a second copy is the same failure as React's own. */
export const SINGLE_COPY = [
  'react',
  'react-dom',
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

/** Anything under the design-system checkout, as Vite sees a path: resolved, with forward slashes. */
const tectonCheckout = new RegExp(
  tectonCheckoutDirectory()
    .split(sep)
    .join('/')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/',
)

/** Externalized, they would keep Node's resolution and find the linked checkout's own React. */
export const INLINE_DEPS = [
  tectonCheckout,
  /lucide-react/,
  /react-aria/,
  /@react-(aria|stately|types)/,
]

/** The shell, the only package here that declares every one of these, as an importer. */
const shellImporter = fileURLToPath(new URL('../../apps/shell/package.json', import.meta.url))

/** One of SINGLE_COPY, or a subpath of one. */
const singleCopySpecifier = new RegExp(
  `^(?:${SINGLE_COPY.map(name => name.replace('/', '\\/')).join('|')})(?:\\/|$)`,
)

/**
 * `dedupe` alone resolves from the project root, where these projects have no `node_modules`, so
 * each import of one of these is resolved again as if the shell made it. The specifier stays bare,
 * which keeps the package's `exports`: an alias to its directory would fall back to `main`, which
 * for @tanstack/react-router is the CommonJS build, whose router-core warns of a circular require.
 */
export const singleCopyForTests = {
  name: 'single-copy-for-tests',
  enforce: 'pre',
  resolveId(source, _importer, options) {
    if (!singleCopySpecifier.test(source)) return null
    // A package only the design system depends on resolves to nothing here, and has one copy already.
    return this.resolve(source, shellImporter, { ...options, skipSelf: true })
  },
}

/** With the framework packages' TypeScript source rather than their dist/ (tools/workspace). */
export const tectonResolveForTests = {
  ...sourceResolveForTests,
  dedupe: SINGLE_COPY,
}

export const tectonServerForTests = { deps: { inline: INLINE_DEPS } }
