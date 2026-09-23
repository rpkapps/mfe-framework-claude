#!/usr/bin/env node
/** The same generation the plugin runs, so a fresh clone resolves `#mfe/*` without a build. */

import { relative, sep } from 'node:path'
import { parseArgs } from 'node:util'

import { generateContainer } from '../generate/container.ts'
import { generateRouteTree, ownsRouteTree } from '../generate/route-tree.ts'
import { seedLocalRuntimeConfig } from '../generate/runtime-config.ts'

const USAGE = `
mfe-generate [options]

Writes what the build would generate for the container in the current
directory: the #mfe/* modules, the registry entry, the runtime
configuration schema and .env.example, and an App's route tree. It also
adds any declared default missing from public/runtime-config.json, the
dev server's copy, and never changes a value already there.

Options:
  --root <directory>  the container to generate for (default: the working directory)
  --help              show this message
`

export interface GenerateResult {
  readonly packageName: string
  /** What was written, relative to the container root. */
  readonly paths: readonly string[]
  /** Findings in the container's own sources, which the build reports too. */
  readonly diagnostics: readonly Error[]
  /** Things only the developer can do, such as supplying a required local value. */
  readonly notes: readonly string[]
}

/** `relative()` answers in the host's separator; every other spelling here is POSIX. */
function report(containerRoot: string, path: string): string {
  return relative(containerRoot, path).split(sep).join('/')
}

/** Exported so a test can generate a container without spawning a process. */
export async function generate(root: string): Promise<GenerateResult> {
  const { plan, written } = generateContainer({ containerRoot: root })
  const paths = written.map(file => report(plan.options.containerRoot, file.path))

  if (ownsRouteTree(plan)) {
    paths.push(report(plan.options.containerRoot, await generateRouteTree(plan)))
  }

  const notes: string[] = []
  const local = seedLocalRuntimeConfig(plan)
  if (local !== null) {
    const localPath = report(plan.options.containerRoot, local.path)
    if (local.written) paths.push(localPath)
    if (local.unreadable !== undefined) {
      notes.push(`${localPath} was left as it is: ${local.unreadable}. Fix it to get the defaults.`)
    }
    if (local.missing.length > 0) {
      notes.push(
        `${localPath} has no value for ${local.missing.join(', ')}. Add one for local development; it has no default.`,
      )
    }
  }

  return {
    packageName: plan.options.packageName,
    paths: [...paths].sort(),
    diagnostics: plan.diagnostics,
    notes,
  }
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

  let result: GenerateResult
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
