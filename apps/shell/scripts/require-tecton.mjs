/**
 * Fails with one sentence when the design system is not checked out.
 *
 * `@tecton/react` is a link to a sibling repository. pnpm creates that link
 * whether or not the target exists, so `pnpm install` reports success and the
 * absence surfaces much later — as half a dozen "cannot find module" errors
 * from tsc, or an unresolvable import deep inside a bundler run. Neither says
 * what to do.
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Resolving the manifest, not the directory: a dangling link has neither. */
export function tectonIsPresent() {
  return existsSync(resolve(shellRoot, 'node_modules/@tecton/react/package.json'))
}

export function requireTecton() {
  if (tectonIsPresent()) return

  throw new Error(
    'The shell needs the Tecton design system, checked out beside this repository:\n\n' +
      '  <parent>/\n' +
      '    mfe-framework-claude/   this repository\n' +
      '    tecton-ui-1/            git clone of the design system\n\n' +
      'Clone it there and run `pnpm install` again. pnpm links it without checking\n' +
      'that the target exists, which is why install reported success.\n\n' +
      'Everything except apps/shell builds and tests without it.',
  )
}
