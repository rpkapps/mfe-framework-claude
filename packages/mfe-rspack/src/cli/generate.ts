#!/usr/bin/env node
/** The same generation the plugin runs, so a fresh clone resolves `#mfe/*` without a build. */

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import {
  seedLocalRuntimeConfig,
  summarizeGeneration,
  type GenerationSummary,
} from '@company/mfe-build'

import { generateContainer } from '../generate/container.ts'
import { generateHostConfig } from '../generate/host-config.ts'
import { generateRouteTree, ownsRouteTree } from '../generate/route-tree.ts'

const USAGE = `
mfe-generate [options]

Writes what the build would generate for the container in the current
directory: the #mfe/* modules, the registry entry, the runtime
configuration schema and .env.example, and an App's route tree. It also
adds any declared default missing from .mfe/runtime-config.json, the
copy the dev server serves, and never changes a value already there.

With --host it writes what a host (the shell loading the containers)
generates instead: #mfe/config, validated without Zod, and the same
runtime configuration files, from the host's src/mfe.config.ts.

Options:
  --root <directory>  the container or host to generate for (default: the working directory)
  --host              generate a host's runtime configuration
  --help              show this message
`

/** Exported so a test can generate a container without spawning a process. */
export async function generate(root: string): Promise<GenerationSummary> {
  const { plan, written } = generateContainer({ containerRoot: root })
  const paths = written.map(file => file.path)
  if (ownsRouteTree(plan)) paths.push(await generateRouteTree(plan))

  return summarizeGeneration(plan, paths, seedLocalRuntimeConfig(plan))
}

/** A host has no definitions, only its runtime configuration. */
export function generateHost(root: string): GenerationSummary {
  const generation = generateHostConfig({ root })
  if (generation === null) {
    throw new Error(
      `${root} has no src/mfe.config.ts, so there is no host configuration to generate. Declare the host's values there with env(), as a container does.`,
    )
  }
  const { plan, written } = generation
  return summarizeGeneration(
    plan,
    written.map(file => file.path),
    seedLocalRuntimeConfig(plan),
  )
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        root: { type: 'string' },
        host: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.log(USAGE)
    return 1
  }

  if (parsed.values.help === true) {
    console.log(USAGE)
    return 0
  }

  let result: GenerationSummary
  try {
    const root = parsed.values.root ?? process.cwd()
    result = parsed.values.host === true ? generateHost(root) : await generate(root)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }

  if (result.paths.length === 0) {
    console.log(`${result.packageName}: generated output is already current.`)
  } else {
    console.log(result.packageName)
    for (const path of result.paths) console.log(`  ${path}`)
  }
  for (const note of result.notes) console.log(note)

  if (result.diagnostics.length === 0) return 0

  // Nothing else would report these here, so they fail this command too.
  console.error('')
  for (const diagnostic of result.diagnostics) console.error(diagnostic.message)
  return 1
}

// Only run when invoked directly, so the module stays importable by tests. Compared by real path:
// an installed bin is a symlink named `mfe-generate`, which Node follows to this file.
if (
  process.argv[1] !== undefined &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
) {
  process.exitCode = await main(process.argv.slice(2))
}
