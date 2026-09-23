#!/usr/bin/env node
/** The same generation the plugin runs, so a fresh clone resolves `#mfe/*` without a build. */

import { parseArgs } from 'node:util'

import {
  seedLocalRuntimeConfig,
  summarizeGeneration,
  type GenerationSummary,
} from '@company/mfe-build'

import { generateContainer } from '../generate/container.ts'
import { generateRouteTree, ownsRouteTree } from '../generate/route-tree.ts'

const USAGE = `
mfe-generate [options]

Writes what the build would generate for the container in the current
directory: the #mfe/* modules, the registry entry, the runtime
configuration schema and .env.example, and an App's route tree. It also
adds any declared default missing from .mfe/runtime-config.json, the
copy the dev server serves, and never changes a value already there.

Options:
  --root <directory>  the container to generate for (default: the working directory)
  --help              show this message
`

/** Exported so a test can generate a container without spawning a process. */
export async function generate(root: string): Promise<GenerationSummary> {
  const { plan, written } = generateContainer({ containerRoot: root })
  const paths = written.map(file => file.path)
  if (ownsRouteTree(plan)) paths.push(await generateRouteTree(plan))

  return summarizeGeneration(plan, paths, seedLocalRuntimeConfig(plan))
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { root: { type: 'string' }, help: { type: 'boolean', default: false } },
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
    result = await generate(parsed.values.root ?? process.cwd())
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

// Only run when invoked directly, so the module stays importable by tests.
if (
  process.argv[1]?.endsWith('generate.ts') === true ||
  process.argv[1]?.endsWith('generate.js') === true
) {
  process.exitCode = await main(process.argv.slice(2))
}
