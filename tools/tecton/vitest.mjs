/**
 * What a Vitest project needs in order to render design-system components: the
 * test-time counterpart of `tecton-build.mjs`.
 *
 * `@tecton/react` and `@tecton/blocks` are a `link:` to a sibling checkout with
 * its own `node_modules`, so their files resolve their own React — a second
 * copy, whose hooks throw the moment one of its components is rendered by this
 * project's renderer. Module Federation collapses the shared packages in a
 * browser build; a test runner has no such thing.
 */

import { createRequire } from 'node:module'
import { dirname } from 'node:path'

/**
 * Resolved from the shell, which declares every one of these. The workspace
 * root declares none of them, and pnpm's layout means the root `node_modules`
 * is not a place to look.
 */
const fromShell = createRequire(new URL('../../apps/shell/package.json', import.meta.url))

/**
 * Packages that carry React context. A second copy of any of them is the same
 * failure: the icon set's own provider, the toaster's, the router's, and React
 * itself.
 */
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

/**
 * Processed by Vite rather than required by Node, so the aliases below actually
 * apply to them.
 *
 * A dependency Vitest externalizes is loaded with Node's own resolution.
 * `@tecton/react`'s built `dist/` still `import`s `react` and its other peers
 * bare, exactly as `@tecton/blocks`' unbuilt TSX does, and Node resolving that
 * bare specifier from inside the linked checkout finds the checkout's own
 * copy — which is how a design-system icon ended up calling `useContext` on a
 * second copy of React while every alias said otherwise.
 */
export const INLINE_DEPS = [
  /tecton-ui-1/,
  /lucide-react/,
  /react-aria/,
  /@react-(aria|stately|types)/,
]

/**
 * `dedupe` alone is not enough: it resolves from the project root, and these
 * projects are rooted in directories with no `node_modules` of their own. The
 * packages are pinned to this workspace's copies by absolute path instead — the
 * bare specifier and every subpath, so `react/jsx-runtime` lands on the same
 * copy as `react`.
 */
export const singleCopyAliases = SINGLE_COPY.flatMap(name => {
  // A package only the design system depends on has one copy already, so
  // failing to find it here is the absence of a problem rather than an error.
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

/** Spread into a Vitest project's `resolve`. */
export const tectonResolveForTests = { dedupe: SINGLE_COPY, alias: singleCopyAliases }

/** Spread into a Vitest project's `test`. */
export const tectonServerForTests = { deps: { inline: INLINE_DEPS } }
