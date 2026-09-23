#!/usr/bin/env node
/**
 * `tsc` only emits TypeScript; the generator template folders (each generator's own `files`
 * folder, and the shared `files-common` one) are data, not source, so this copies them into
 * `dist` beside the compiled generators after the build. Both `src` (tests) and `dist` (Nx, via
 * `path.join(__dirname, 'files')`) then have a `files` folder next to `generator.js`.
 */

import { cpSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const srcGenerators = join(packageRoot, 'src/generators')
const distGenerators = join(packageRoot, 'dist/src/generators')

// The template folders `generateFiles` reads at runtime.
const templateDirs = ['app/files', 'widget/files', 'shared/files-common']

for (const relative of templateDirs) {
  const from = join(srcGenerators, relative)
  const to = join(distGenerators, relative)
  if (!existsSync(from)) {
    throw new Error(`copy-templates: expected a template folder at ${from}`)
  }
  cpSync(from, to, { recursive: true })
}

// `generators.json`'s `schema` paths point at these; `tsc` only emits `.ts` files, so the JSON
// schemas need copying alongside the compiled generator.ts they describe.
const schemaFiles = ['app/schema.json', 'widget/schema.json']

for (const relative of schemaFiles) {
  const from = join(srcGenerators, relative)
  const to = join(distGenerators, relative)
  if (!existsSync(from)) {
    throw new Error(`copy-templates: expected a schema file at ${from}`)
  }
  copyFileSync(from, to)
}
