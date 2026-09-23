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

/** One registry entry per definition the container exports. */
function entriesFor(published, presentation, origin) {
  return published.definitions.map(definition => {
    const expose = published.entries?.[definition.id]
    if (typeof expose !== 'string') {
      throw new Error(
        `${definition.id}: its container's build names no expose path. Rebuild the container.`,
      )
    }

    return {
      id: definition.id,
      kind: definition.kind,
      // The framework picks the adapter that reads the entry, so it travels in the marker.
      mfe: {
        contractMajor: published.contractMajor,
        ...(published.framework === undefined ? {} : { framework: published.framework }),
      },
      manifestUrl: new URL(published.manifestUrl, origin).href,
      container: published.container,
      expose,
      // A host registers the container with exactly these, so it links the framework scope its
      // shares live in; a container built before framework scopes shares in `default` alone.
      ...(published.shareScopes === undefined ? {} : { shareScopes: published.shareScopes }),
      ...(definition.version === undefined ? {} : { version: definition.version }),
      ...(definition.capabilities === undefined ? {} : { capabilities: definition.capabilities }),
      // The widget catalogue renders a form from this before anything is loaded, so it has to
      // be in the registry rather than behind a container fetch (§16).
      ...(definition.contract === undefined ? {} : { contract: definition.contract }),
      // The build belongs to the container rather than to any definition it exports, so every
      // entry from that build repeats it; a bug report is the only reader (§29).
      ...(published.build === undefined ? {} : { build: published.build }),
      // Declared by the author beside the id, and read statically like the contract above, so a
      // catalogue can show and filter the definition without fetching its container (§16).
      ...(definition.title === undefined ? {} : { title: definition.title }),
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.tags === undefined ? {} : { tags: definition.tags }),
      ...(definition.icon === undefined ? {} : { icon: definition.icon }),
      // Last, because this is the shell's own per-deployment override of what the author declared.
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
    const published = await readJson(join(directory, '.mfe/mfe-registry.json'))

    if (!published) {
      missing.push(name)
      continue
    }

    const port = manifest?.mfe?.port
    if (typeof port !== 'number') {
      throw new Error(`${name}: package.json declares no mfe.port, so its dev URL is unknown.`)
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
