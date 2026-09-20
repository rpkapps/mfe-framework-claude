/**
 * What every build in this repository needs in order to consume the design
 * system, in one place.
 *
 * `@tecton/react` is a `link:` to a sibling checkout rather than a published
 * package, which is what makes the two repositories developable together. Its
 * `exports` map now points at a built `dist/` — unbundled ESM plus a `.d.ts`
 * beside every module — so a consumer here reads compiled output, the same
 * shape a published package would ship. That leaves two problems every
 * consumer still has, so no consumer should be solving them itself.
 *
 * 1. pnpm creates a link whether or not its target exists, so `pnpm install`
 *    reports success and the absence surfaces much later as half a dozen
 *    "cannot find module" errors from a bundler or from tsc — and a checkout
 *    that exists but has never been built fails the same way, pointed at a
 *    `dist/` that is not there yet. `requireTecton` turns either into one
 *    sentence, before anything is read.
 *
 * 2. The linked checkout's `dist/` still imports `react` and the rest of its
 *    peers bare, and resolves them from its own checkout's `node_modules` —
 *    a different physical copy of React and of React Aria from this
 *    workspace's. Module Federation collapses the shared ones at runtime, but
 *    only the ones it was told to share; naming this workspace's directories
 *    absolutely (`tectonResolve`, `useWorkspaceModules`) keeps the rest on one
 *    copy too.
 */

import { existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Resolving the manifest, not the directory: a dangling link has neither.
 *
 * "Present" means only that the link resolves to a checkout — not that the
 * checkout has been built. A present-but-unbuilt checkout has a manifest and
 * no `dist/`, which is exactly the gap `requireTecton` checks for next.
 */
export function tectonIsPresent(packageRoot) {
  return existsSync(resolve(packageRoot, 'node_modules/@tecton/react/package.json'))
}

/** The built output every subpath in the `exports` map ultimately resolves to. */
function tectonIsBuilt(packageRoot) {
  return existsSync(resolve(packageRoot, 'node_modules/@tecton/react/dist/styles/scoped.css'))
}

export function requireTecton(packageRoot, consumer = 'This package') {
  if (!tectonIsPresent(packageRoot)) {
    throw new Error(
      `${consumer} needs the Tecton design system, checked out beside this repository:\n\n` +
        '  <parent>/\n' +
        '    mfe-framework-claude/   this repository\n' +
        '    tecton-ui-1/            git clone of the design system\n\n' +
        'Clone it there and run `pnpm install` again. pnpm links it without checking\n' +
        'that the target exists, which is why install reported success.',
    )
  }

  if (!tectonIsBuilt(packageRoot)) {
    throw new Error(
      `${consumer} needs a built @tecton/react: run \`pnpm install && pnpm --filter @tecton/react build\` inside tecton-ui-1.`,
    )
  }
}

/**
 * Tailwind resolves a stylesheet's `@import`s from that stylesheet's own
 * location and adds `NODE_PATH` to its module directories. Set from the config
 * rather than from a script: cross-platform, and before Tailwind reads it.
 */
export function useWorkspaceModules(packageRoot) {
  process.env['NODE_PATH'] = [
    resolve(packageRoot, 'node_modules'),
    resolve(repoRoot, 'node_modules'),
    ...(process.env['NODE_PATH'] === undefined ? [] : [process.env['NODE_PATH']]),
  ].join(delimiter)
}

/** The `resolve` block for a build that compiles the linked design system. */
export function tectonResolve(packageRoot) {
  return {
    // Symlinks stay resolved, so every other package still finds its own
    // transitive dependencies the way pnpm's layout expects.
    modules: [
      'node_modules',
      resolve(packageRoot, 'node_modules'),
      resolve(repoRoot, 'node_modules'),
    ],
  }
}
