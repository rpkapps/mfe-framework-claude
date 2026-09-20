#!/usr/bin/env node
/**
 * Type-checks a package's own source, tolerating the diagnostics that come from
 * a dependency it consumes as unbuilt TSX.
 *
 * `tsc` cannot exclude a file it was asked to resolve, so consuming
 * `@tecton/blocks`' raw `.tsx` type-checks it too, under options it is not
 * written against. Those diagnostics are reported and do not fail the check;
 * anything under this package's own directories does.
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

// Before tsc, so a missing checkout is one sentence rather than a page of
// "cannot find module" from every file that imports a component.
try {
  requireTecton(packageRoot, `${label}`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

/**
 * TypeScript's own entry, run with this Node — not the `.bin` shim, which is an
 * extensionless shell script `spawnSync` cannot execute on Windows (ENOENT for
 * a file that plainly exists) and whose `.CMD` sibling Node refuses to spawn
 * without a shell. Resolution starts from the package being checked, so one
 * that installs its own TypeScript gets that copy.
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

// This package's own files: its source directories, and the configs at its root.
const isOwn = line =>
  /^(src|scripts|tests|\.mfe)[/\\]/.test(line) || /^[^/\\]+\.(ts|tsx|mts)\(/.test(line)
const lines = `${result.stdout}${result.stderr}`.split('\n').filter(line => line.trim() !== '')
// A diagnostic owns the indented lines that follow it.
let own = false
const ours = []
const theirs = new Set()
for (const line of lines) {
  if (!/^\s/.test(line)) {
    own = isOwn(line)
    if (!own) theirs.add(line.slice(0, line.indexOf('(')))
  }
  if (own) ours.push(line)
}

for (const line of ours) console.log(line)

if (theirs.size > 0) {
  console.log(`\nDependency source, not type-checked by this project:`)
  for (const file of [...theirs].sort()) console.log(`  ${file}`)
}

if (ours.length > 0) {
  console.error(`\nErrors in ${label}.`)
  process.exit(1)
}

console.log(`\n${label} type-checks clean.`)
