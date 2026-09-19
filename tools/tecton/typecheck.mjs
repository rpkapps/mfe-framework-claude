#!/usr/bin/env node
/**
 * Type-checks a package's own source when it consumes the design system as
 * unbuilt TSX.
 *
 * `tsc` cannot exclude a file it was asked to resolve, so consuming unbuilt TSX
 * type-checks the dependency's source too, under options it is not written
 * against. Those diagnostics are reported but do not fail the check; anything
 * under this package's own directories does, including an error raised at a
 * call site here for misusing a design-system prop.
 *
 * Usage, from a package's `typecheck` script:
 *   node ../../tools/tecton/typecheck.mjs [label]
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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

/** A package may install tsc itself, or take the workspace root's. */
const tsc = [
  resolve(packageRoot, 'node_modules/.bin/tsc'),
  resolve(packageRoot, '../../node_modules/.bin/tsc'),
].find(candidate => existsSync(candidate))

if (tsc === undefined) {
  console.error('No tsc found for this package or in the workspace root.')
  process.exit(1)
}

const result = spawnSync(tsc, ['--noEmit', '--pretty', 'false'], {
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
