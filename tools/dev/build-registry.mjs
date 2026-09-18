#!/usr/bin/env node
/**
 * Assembles the shell's registry from the containers' own generated
 * descriptors.
 *
 * Nobody hand-writes registry JSON (§10.3.1). Every fact a shell needs to load
 * a container — its definition ids, kinds, versions, capabilities, federation
 * name and expose paths — is emitted by that container's build into
 * `.mfe/mfe-registry.json`, so copying any of it here would be a second source
 * that drifts. A hand-written registry is exactly how this repository ended up
 * pointing at containers that do not exist.
 *
 * Two things genuinely are the shell's and are read from
 * `apps/shell/registry.source.json`: how an entry is presented in the chrome,
 * and the deliberately invalid fixtures that prove quarantine.
 *
 * The dev URL is assembled from each package's own `mfe.port`, the same block
 * `pnpm dev` reads, so a port is declared once.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const shellRoot = join(repoRoot, 'apps/shell')
const output = join(shellRoot, 'public/registry.json')

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** One registry entry per definition the container exports. */
function entriesFor(descriptor, presentation, origin) {
  return descriptor.definitions.map(definition => {
    const expose = descriptor.entries?.[definition.id]
    if (typeof expose !== 'string') {
      throw new Error(
        `${definition.id}: its container's descriptor names no expose path. Rebuild the container.`,
      )
    }

    return {
      id: definition.id,
      kind: definition.kind,
      mfe: { contractMajor: descriptor.contractMajor },
      manifestUrl: new URL(descriptor.manifestUrl, origin).href,
      container: descriptor.container,
      expose,
      ...(definition.version === undefined ? {} : { version: definition.version }),
      ...(definition.capabilities === undefined ? {} : { capabilities: definition.capabilities }),
      ...(presentation[definition.id] ?? {}),
    }
  })
}

async function main() {
  const source = await readJson(join(shellRoot, 'registry.source.json'))
  if (!source) throw new Error(`No registry source at ${join(shellRoot, 'registry.source.json')}`)

  const examplesDir = join(repoRoot, 'examples')
  const directories = (await readdir(examplesDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

  const entries = []
  const missing = []

  for (const name of directories) {
    const directory = join(examplesDir, name)
    const manifest = await readJson(join(directory, 'package.json'))
    const descriptor = await readJson(join(directory, '.mfe/mfe-registry.json'))

    if (!descriptor) {
      missing.push(name)
      continue
    }

    const port = manifest?.mfe?.port
    if (typeof port !== 'number') {
      throw new Error(`${name}: package.json declares no mfe.port, so its dev URL is unknown.`)
    }

    entries.push(...entriesFor(descriptor, source.presentation ?? {}, `http://localhost:${port}/`))
  }

  if (missing.length > 0) {
    throw new Error(
      `No generated descriptor for ${missing.join(', ')}. Run \`pnpm run generate\` first: ` +
        'the registry is assembled from what each container generates, never hand-written.',
    )
  }

  const registry = [...entries, ...(source.fixtures ?? [])]
  await writeFile(output, `${JSON.stringify(registry, null, 2)}\n`)

  console.log(
    `Wrote ${entries.length} generated entries and ${(source.fixtures ?? []).length} quarantine fixtures:`,
  )
  for (const entry of entries) console.log(`  ${entry.id.padEnd(14)} ${entry.manifestUrl}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
