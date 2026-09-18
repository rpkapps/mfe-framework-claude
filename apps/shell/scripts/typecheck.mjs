#!/usr/bin/env node
/**
 * Type-checks the shell's own source.
 *
 * `tsc` cannot exclude a file it was asked to resolve, so consuming @tecton/react
 * as unbuilt TSX type-checks that repository's source too — under *this*
 * workspace's options rather than the ones it is written against (it sets
 * `strict` but not `exactOptionalPropertyTypes` or `noUncheckedIndexedAccess`).
 * Those diagnostics are reported, never hidden, but they do not fail this check
 * because the shell cannot fix them. Anything under apps/shell does fail it,
 * including errors raised at a shell call site for misusing a design-system prop.
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const result = spawnSync(resolve(shellRoot, 'node_modules/.bin/tsc'), ['--noEmit', '--pretty', 'false'], {
  cwd: shellRoot,
  encoding: 'utf8',
})

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
