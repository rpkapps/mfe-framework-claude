#!/usr/bin/env node
/**
 * Assembles the shell's registry from the entries the containers' own builds publish.
 *
 * Nobody hand-writes registry JSON (§10.3.1). Copying any of it here would be a second source
 * that drifts, which is how this repository ended up pointing at containers that do not exist.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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

/**
 * The build already wrote finished entries; only where it is served, and the shell's own
 * presentation, are known here.
 */
function entriesFor(published, presentation, origin) {
  return published.map(entry => ({
    ...entry,
    manifestUrl: new URL(entry.manifestUrl, origin).href,
    // Last, because this is the shell's own per-deployment override of what the author declared.
    ...(presentation[entry.id] ?? {}),
  }))
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
    // Contract and transport packages support the examples; only containers publish entries.
    if (!manifest?.mfe) continue
    const published = await readJson(join(directory, '.mfe/mfe-registry.json'))

    if (!published) {
      missing.push(name)
      continue
    }

    const port = manifest?.mfe?.port
    if (typeof port !== 'number') {
      throw new Error(`${name}: package.json declares no mfe.port, so its dev URL is unknown.`)
    }

    // A file generated before the build wrote entries holds one object rather than a list.
    if (!Array.isArray(published)) {
      throw new Error(
        `${name}: .mfe/mfe-registry.json predates registry entries. Run \`pnpm run generate\` first.`,
      )
    }

    entries.push(...entriesFor(published, source.presentation ?? {}, `http://localhost:${port}/`))
  }

  if (missing.length > 0) {
    throw new Error(
      `Nothing generated for ${missing.join(', ')}. Run \`pnpm run generate\` first: ` +
        'the registry is assembled from what each container generates, never hand-written.',
    )
  }

  const registry = [...entries, ...(source.fixtures ?? [])]
  // The registry is generated, so `public/` does not exist until something makes it.
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(registry, null, 2)}\n`)

  console.log(
    `Wrote ${entries.length} generated entries and ${(source.fixtures ?? []).length} rejected fixtures:`,
  )
  for (const entry of entries) console.log(`  ${entry.id.padEnd(14)} ${entry.manifestUrl}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
