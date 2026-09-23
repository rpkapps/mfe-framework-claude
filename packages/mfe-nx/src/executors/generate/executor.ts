/**
 * `@company/mfe-nx:generate`: the same generation the build runs, so a fresh clone's typecheck,
 * tests and editor resolve `#mfe/*` without a build. Every other target of a generated container
 * depends on it.
 */

import { join, relative, sep } from 'node:path'

import { logger, type ExecutorContext } from '@nx/devkit'

import { createBuildError, seedLocalRuntimeConfig } from '@company/mfe-build'

import { generateContainer } from '../../generate/container.ts'

/** The executor takes no options: the container is the project it runs for. */
export type GenerateExecutorOptions = Readonly<Record<string, never>>

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

/**
 * Writes the generated modules, then adds any declared default missing from the dev server's
 * `public/` copy of the runtime configuration; a value already there is never changed.
 */
export function generate(containerRoot: string): GenerateResult {
  const { plan, written } = generateContainer({ containerRoot })
  const paths = written.map(file => report(plan.options.containerRoot, file.path))

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

export default function generateExecutor(
  _options: GenerateExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  let result: GenerateResult
  try {
    result = generate(containerRootOf(context))
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error))
    return Promise.resolve({ success: false })
  }

  if (result.paths.length === 0) {
    logger.info(`${result.packageName}: generated output is already current.`)
  } else {
    logger.info([result.packageName, ...result.paths.map(path => `  ${path}`)].join('\n'))
  }
  for (const note of result.notes) logger.warn(note)

  // Nothing else reports these when only the tests or the typecheck run, so they fail here too.
  for (const diagnostic of result.diagnostics) logger.error(diagnostic.message)
  return Promise.resolve({ success: result.diagnostics.length === 0 })
}

function containerRootOf(context: ExecutorContext): string {
  const project =
    context.projectName === undefined
      ? undefined
      : context.projectsConfigurations.projects[context.projectName]

  if (project === undefined) {
    throw createBuildError({
      file: join(context.root, 'nx.json'),
      operation: 'find the container to generate for',
      expected: 'the executor to run as a target of a project',
      observed:
        context.projectName === undefined
          ? 'no project'
          : `a project '${context.projectName}' the workspace does not configure`,
      declaredBy: 'The generate executor',
      repair: 'Run it through the project target: nx run <project>:generate.',
    })
  }

  return join(context.root, project.root)
}
