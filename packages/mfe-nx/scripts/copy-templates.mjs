#!/usr/bin/env node
/**
 * `tsc` only emits TypeScript; the generator template folders (each generator's own `files`
 * folder, and the shared `files-common` one) and the JSON schemas `generators.json` and
 * `executors.json` point at are data, not source, so this copies them into `dist` beside the
 * compiled modules after the build. Both `src` (tests) and `dist` (Nx, via
 * `path.join(__dirname, 'files')`) then have a `files` folder next to `generator.js`.
 */

import { cpSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const src = join(packageRoot, 'src')
const dist = join(packageRoot, 'dist/src')

// The template folders `generateFiles` reads at runtime.
const templateDirs = [
  'generators/app/files',
  'generators/widget/files',
  'generators/shared/files-common',
]

for (const relative of templateDirs) {
  const from = join(src, relative)
  if (!existsSync(from)) {
    throw new Error(`copy-templates: expected a template folder at ${from}`)
  }
  cpSync(from, join(dist, relative), { recursive: true })
}

const schemaFiles = [
  'generators/app/schema.json',
  'generators/widget/schema.json',
  'executors/generate/schema.json',
]

for (const relative of schemaFiles) {
  const from = join(src, relative)
  if (!existsSync(from)) {
    throw new Error(`copy-templates: expected a schema file at ${from}`)
  }
  copyFileSync(from, join(dist, relative))
}
