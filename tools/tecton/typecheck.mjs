#!/usr/bin/env node
/**
 * Type-checks a package: the design-system checkout is verified first, and `tsc` is run the one
 * way that also works on Windows.
 *
 * Usage, from a package's `typecheck` script:
 *   node ../../tools/tecton/typecheck.mjs [label]
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { relative, resolve } from 'node:path'

import { requireTecton } from './tecton-build.mjs'

const packageRoot = process.cwd()
const label = process.argv[2] ?? relative(resolve(packageRoot, '../..'), packageRoot)

// Before tsc, so a missing checkout is one sentence rather than a page of "cannot find module".
try {
  requireTecton(packageRoot, `${label}`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

/**
 * TypeScript's own entry rather than the `.bin` shim, which `spawnSync` cannot execute on
 * Windows; resolution starts from the package being checked, so its own copy wins.
 */
const requireFrom = createRequire(resolve(packageRoot, 'package.json'))

let tsc
try {
  tsc = requireFrom.resolve('typescript/bin/tsc')
} catch {
  console.error('No TypeScript found for this package or in the workspace root.')
  process.exit(1)
}

const result = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false'], {
  cwd: packageRoot,
  encoding: 'utf8',
})

if (result.error) {
  console.error(`Could not run tsc: ${result.error.message}`)
  process.exit(1)
}

const output = `${result.stdout}${result.stderr}`.trim()

if (output !== '') {
  console.log(output)
  console.error(`\nErrors in ${label}.`)
  process.exit(1)
}

console.log(`\n${label} type-checks clean.`)
