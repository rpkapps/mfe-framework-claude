#!/usr/bin/env node
/**
 * Type-checks the shell's own source.
 *
 * `tsc` has no way to exclude a file it was asked to resolve, so a project that
 * consumes unbuilt TypeScript from a dependency type-checks that dependency's
 * source too, under *this* workspace's compiler options rather than the ones
 * the dependency is written and released against. @tecton/react is a separate
 * repository with `strict` but neither `exactOptionalPropertyTypes` nor
 * `noUncheckedIndexedAccess`, so a handful of its files report under ours.
 *
 * Those are its diagnostics, not the shell's, and the shell cannot fix them: it
 * only consumes the package. So they are reported as a count and a file list —
 * never hidden — and they do not fail this check. Anything under apps/shell
 * does, including every error TypeScript raises at a shell call site because a
 * design-system prop was used wrongly.
 */

import { spawnSync } from 'node:child_process'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsc = resolve(shellRoot, 'node_modules/.bin/tsc')

const result = spawnSync(tsc, ['--noEmit', '--pretty', 'false'], {
  cwd: shellRoot,
  encoding: 'utf8',
})

if (result.error) {
  console.error(`Could not run tsc: ${result.error.message}`)
  process.exit(1)
}

const DIAGNOSTIC = /^(?<file>[^(]+)\((?<line>\d+),(?<column>\d+)\): (?<severity>error|warning) TS/

/** Groups each diagnostic with its indented continuation lines. */
function parseDiagnostics(output) {
  const diagnostics = []
  for (const line of output.split('\n')) {
    const match = DIAGNOSTIC.exec(line)
    if (match?.groups) {
      diagnostics.push({ file: match.groups.file, severity: match.groups.severity, lines: [line] })
      continue
    }
    if (line.trim() === '') continue
    const last = diagnostics.at(-1)
    if (last) last.lines.push(line)
    else diagnostics.push({ file: '<tsc>', severity: 'error', lines: [line] })
  }
  return diagnostics
}

const diagnostics = parseDiagnostics(`${result.stdout}${result.stderr}`)
const isOwn = diagnostic => !relative(shellRoot, resolve(shellRoot, diagnostic.file)).startsWith('..')

const own = diagnostics.filter(isOwn)
const external = diagnostics.filter(diagnostic => !isOwn(diagnostic))

for (const diagnostic of own) console.log(diagnostic.lines.join('\n'))

if (external.length > 0) {
  const files = [...new Set(external.map(diagnostic => diagnostic.file))].sort()
  console.log(
    `\n${external.length} diagnostic(s) in dependency source, not type-checked by this project:`,
  )
  for (const file of files) console.log(`  ${file}`)
  console.log(
    "  These are the dependency's own files under this workspace's stricter compiler options.",
  )
}

if (own.length > 0) {
  console.error(`\n${own.length} error(s) in apps/shell.`)
  process.exit(1)
}

console.log(`\napps/shell type-checks clean.`)
