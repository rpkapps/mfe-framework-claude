#!/usr/bin/env node
/**
 * `mfe-generate` — everything a build generates, without a build.
 *
 * `#mfe/config`, `#mfe/fetch`, `#mfe/meta` and the route tree are build output,
 * so an editor opened on a fresh clone resolves none of them and neither does
 * `tsc`. Starting the bundler to fix that would make the type of a file depend
 * on whether a dev server happened to be running. This runs the same generation
 * the plugin runs, against the container in the working directory, and it is
 * what project setup and every `generate` script invoke.
 *
 * It runs the sources it imports directly, with no build step of its own, the
 * way the scaffold CLI does.
 */

import { relative, sep } from 'node:path'
import { parseArgs } from 'node:util'

import { generateContainer } from '../generate/container.ts'
import { generateRouteTree, ownsRouteTree } from '../generate/route-tree.ts'

const USAGE = `
mfe-generate [options]

Writes what the build would generate for the container in the current
directory: the #mfe/* modules, the registry descriptor, the runtime
configuration schema and .env.example, and an App's route tree.

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
}

/**
 * The path this command prints, in the one spelling every platform shares.
 *
 * `relative()` answers in the host's separator, so Windows printed
 * `.mfe\fetch.ts` where the emitter, the generated imports and the
 * documentation all say `.mfe/fetch.ts` — three spellings of one file in a
 * tool whose whole output is file names. The emitter already normalizes; this
 * is the same rule at the other end.
 */
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

  return {
    packageName: plan.options.packageName,
    paths: [...paths].sort(),
    diagnostics: plan.diagnostics,
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

  if (result.diagnostics.length === 0) return 0

  // A compilation reports these as build errors. Nothing else would report them
  // here, so they fail this command too, one line each: every diagnostic names
  // the file to open and the repair to make.
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
