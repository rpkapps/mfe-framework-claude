#!/usr/bin/env node
/**
 * Fails when a package's `dist/` is missing or older than its source; run in the package.
 *
 * It is the package's `prepack`, so a pack never ships a stale build. Packing does not build:
 * `changeset publish` packs every package at once, and a package's build compiles against the
 * `dist/` of the packages it depends on, so a build in each `prepack` would rewrite those while
 * another package reads them. `pnpm release` builds them all first, once, in dependency order.
 *
 * With `--quiet` it is the check in `build:stale`, which builds a package only when this fails, so
 * a script run while other processes read a `dist/` that is already current leaves it alone.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const packageRoot = process.cwd()
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

/** Every file the manifest points a consumer at, the source condition aside. */
function publishedEntries() {
  const entries = new Set()
  for (const field of ['main', 'types']) {
    if (typeof manifest[field] === 'string') entries.add(manifest[field])
  }
  for (const target of Object.values(manifest.exports ?? {})) {
    if (typeof target !== 'object' || target === null) continue
    for (const [condition, path] of Object.entries(target)) {
      if (condition !== 'mfe-source' && typeof path === 'string') entries.add(path)
    }
  }
  return [...entries]
}

function modifiedAt(path) {
  try {
    return statSync(join(packageRoot, path)).mtimeMs
  } catch {
    return null
  }
}

/** The newest source file a build would compile; tests are never compiled. */
function newestSource(directory) {
  let newest = 0
  for (const entry of readdirSync(join(packageRoot, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') newest = Math.max(newest, newestSource(path))
    } else if (!/\.test\.tsx?$/.test(entry.name)) {
      newest = Math.max(newest, modifiedAt(path) ?? 0)
    }
  }
  return newest
}

const entries = publishedEntries()
const missing = entries.filter(path => modifiedAt(path) === null)
const oldest = Math.min(...entries.map(path => modifiedAt(path) ?? 0))
const stale = missing.length === 0 && newestSource('src') > oldest

if ((missing.length > 0 || stale) && process.argv.includes('--quiet')) process.exit(1)

if (missing.length > 0 || stale) {
  const problem =
    missing.length > 0
      ? `its build is missing ${missing.join(', ')}`
      : 'its source changed after it was last built'
  console.error(
    `${manifest.name} was not packed: ${problem}.\n` +
      'Run `pnpm run build` at the repository root, which builds every package in dependency\n' +
      'order, and pack again. Packing does not build, because `changeset publish` packs the\n' +
      'packages at the same time and each build reads the dist/ of the packages it depends on.',
  )
  process.exit(1)
}
