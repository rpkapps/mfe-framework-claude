/**
 * `@tecton/react` is a `link:` that pnpm creates whether or not the target exists or has been
 * built, and whose files would resolve their peers from that checkout's own `node_modules`.
 */

import { existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sourceConditionNames } from '../workspace/conditions.mjs'
import { tectonCheckoutDirectory, tectonLinkPath } from './location.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Resolving the manifest, not the directory: a dangling link has neither. */
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
      `${consumer} needs the Tecton design system at ${tectonLinkPath()}, relative to this\n` +
        'repository, which is where the `@tecton/react` override in pnpm-workspace.yaml points.\n\n' +
        'Clone it there and run `pnpm install` again, or change that override to where your\n' +
        'checkout is. pnpm links it without checking that the target exists, which is why\n' +
        'install reported success.',
    )
  }

  if (!tectonIsBuilt(packageRoot)) {
    throw new Error(
      `${consumer} needs a built @tecton/react: run \`pnpm install && pnpm --filter @tecton/react build\` inside ${tectonCheckoutDirectory()}.`,
    )
  }
}

/**
 * Tailwind resolves a stylesheet's `@import`s from its own location and adds `NODE_PATH` to the
 * module directories it searches, so this is set from the config rather than from a script.
 */
export function useWorkspaceModules(packageRoot) {
  process.env['NODE_PATH'] = [
    resolve(packageRoot, 'node_modules'),
    resolve(repoRoot, 'node_modules'),
    ...(process.env['NODE_PATH'] === undefined ? [] : [process.env['NODE_PATH']]),
  ].join(delimiter)
}

/**
 * The consumer's `node_modules`, then the workspace's, before each module's own. The design
 * system's files are resolved where the link points, and walking up from there finds the
 * checkout's own React, React DOM and recharts, which Module Federation would provide beside this
 * workspace's: only one copy runs, but both are emitted, recharts at 515 kB. Symlinks stay
 * resolved, so a package still finds whatever neither directory holds among its own dependencies.
 * The cost is that a package depending on another version of something the consumer installs gets
 * the consumer's; building the shell and every example both ways changed nothing but the design
 * system's copies.
 */
export function tectonResolve(packageRoot) {
  return {
    modules: [
      resolve(packageRoot, 'node_modules'),
      resolve(repoRoot, 'node_modules'),
      'node_modules',
    ],
    // The framework packages' TypeScript source rather than their dist/ (tools/workspace).
    conditionNames: sourceConditionNames,
  }
}
