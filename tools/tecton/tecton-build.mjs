/**
 * What every build in this repository needs in order to consume the design
 * system, in one place.
 *
 * `@tecton/react` is a `link:` to a sibling checkout, which is what makes the
 * two repositories developable together, and it costs two things. Its files
 * resolve `react` and the rest of its peers from that checkout's own
 * `node_modules` — a second physical copy — so `tectonResolve` and
 * `useWorkspaceModules` name this workspace's directories absolutely. And pnpm
 * creates the link whether or not its target exists or has been built, so
 * `requireTecton` says which of the two is missing before anything is read.
 */

import { existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
