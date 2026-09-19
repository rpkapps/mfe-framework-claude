/**
 * What every build in this repository needs in order to consume the design
 * system, in one place.
 *
 * `@tecton/react` is a `link:` to a sibling checkout rather than a published
 * package, which is what makes the two repositories developable together — and
 * which brings two problems with it that every consumer here has, so no
 * consumer should be solving them itself.
 *
 * 1. pnpm creates a link whether or not its target exists, so `pnpm install`
 *    reports success and the absence surfaces much later as half a dozen
 *    "cannot find module" errors from a bundler or from tsc. `requireTecton`
 *    turns that into one sentence, before anything is read.
 *
 * 2. The linked checkout resolves its own dependencies from its own
 *    `node_modules`, which is a different physical copy of React and of React
 *    Aria from this workspace's. Module Federation collapses the shared ones at
 *    runtime, but only the ones it was told to share; naming this workspace's
 *    directories absolutely keeps the rest on one copy too.
 */

import { existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Resolving the manifest, not the directory: a dangling link has neither. */
export function tectonIsPresent(packageRoot) {
  return existsSync(resolve(packageRoot, 'node_modules/@tecton/react/package.json'))
}

export function requireTecton(packageRoot, consumer = 'This package') {
  if (tectonIsPresent(packageRoot)) return

  throw new Error(
    `${consumer} needs the Tecton design system, checked out beside this repository:\n\n` +
      '  <parent>/\n' +
      '    mfe-framework-claude/   this repository\n' +
      '    tecton-ui-1/            git clone of the design system\n\n' +
      'Clone it there and run `pnpm install` again. pnpm links it without checking\n' +
      'that the target exists, which is why install reported success.',
  )
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
