#!/usr/bin/env node
/**
 * Type-checks the shell's own source. `tsc` cannot exclude a file it was asked
 * to resolve, so consuming unbuilt TSX type-checks the dependency's source too,
 * under options it is not written against. Those diagnostics are reported but
 * do not fail this check; anything under apps/shell does, including errors
 * raised at a shell call site for misusing a design-system prop.
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { requireTecton } from './require-tecton.mjs'

const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Before tsc, so a missing checkout is one sentence rather than a page of
// "cannot find module" from every file that imports a component.
try {
  requireTecton()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const result = spawnSync(
  resolve(shellRoot, 'node_modules/.bin/tsc'),
  ['--noEmit', '--pretty', 'false'],
  {
    cwd: shellRoot,
    encoding: 'utf8',
  },
)

if (result.error) {
  console.error(`Could not run tsc: ${result.error.message}`)
  process.exit(1)
}

const isOwn = line => /^(src|scripts|tests)[/\\]/.test(line)
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
  console.error(`\nErrors in apps/shell.`)
  process.exit(1)
}

console.log('\napps/shell type-checks clean.')
